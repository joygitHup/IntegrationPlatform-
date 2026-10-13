# 每天凌晨 pg_dump，默认保留 14 天
# Windows 任务计划：每天 03:00 触发 powershell -File D:\path\to\backup_postgres.ps1
param(
    [string]$DatabaseUrl = $env:DATABASE_URL,
    [string]$BackupDir   = $env:BACKUP_DIR,
    [int]$RetentionDays  = 14
)

if (-not $DatabaseUrl) {
    $DatabaseUrl = "postgres://integration:integration@localhost:5432/integration"
}
if (-not $BackupDir) {
    $BackupDir = "$env:USERPROFILE\backups\integration-platform"
}
$RetentionDays = if ($env:BACKUP_RETENTION_DAYS) { [int]$env:BACKUP_RETENTION_DAYS } else { $RetentionDays }

# 从 URL 拆解 pg_dump 所需参数
# postgres://user:pass@host:port/dbname
$uri = [System.Uri]$DatabaseUrl
$hostPort = if ($uri.Port -gt 0) { "$($uri.Host):$($uri.Port)" } else { $uri.Host }
$user = $uri.UserInfo.Split(':')[0]
$pass = if ($uri.UserInfo.Contains(':')) { $uri.UserInfo.Split(':')[1] } else { "" }
$db   = $uri.AbsolutePath.TrimStart('/')

New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
$ts    = Get-Date -Format "yyyyMMdd-HHmmss"
$file  = Join-Path $BackupDir "integration-$ts.sql.gz"

Write-Host "[$(Get-Date)] dumping $db from $hostPort as $user → $file"

$env:PGPASSWORD = $pass
try {
    # 优先用 pg_dump.exe；找不到就尝试 PostgresSQL 默认安装路径
    $pgDump = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
    if (-not $pgDump) {
        $candidates = @(
            "${env:ProgramFiles}\PostgreSQL\*\bin\pg_dump.exe",
            "${env:ProgramFiles(x86)}\PostgreSQL\*\bin\pg_dump.exe",
            "${env:LOCALAPPDATA}\Programs\PostgreSQL\*\bin\pg_dump.exe"
        )
        foreach ($glob in $candidates) {
            $found = Get-Item $glob -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($found) { $pgDump = $found.FullName; break }
        }
    }
    if (-not $pgDump) {
        throw "pg_dump.exe not found. Install PostgreSQL client or add it to PATH."
    }

    $temp = Join-Path $env:TEMP "integration-$ts.sql"
    if ($pgDump -is [string]) {
        & $pgDump "--host=$($uri.Host)" "--port=$($uri.Port)" "--username=$user" "--dbname=$db" "--file=$temp"
    } else {
        & $pgDump.Source "--host=$($uri.Host)" "--port=$($uri.Port)" "--username=$user" "--dbname=$db" "--file=$temp"
    }
    if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (exit=$LASTEXITCODE)" }

    # 用 gzip（若装了 7z 或 gzip 命令）或 .NET 自带 GzipStream
    $gzip = Get-Command gzip.exe -ErrorAction SilentlyContinue
    if ($gzip) {
        & $gzip $temp
        Move-Item "$temp.gz" $file -Force
    } else {
        # 用 .NET 压缩
        Add-Type -AssemblyName System.IO.Compression
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $in  = [System.IO.File]::OpenRead($temp)
        $out = [System.IO.File]::Create($file)
        $gz  = New-Object System.IO.Compression.GzipStream($out, [System.IO.Compression.CompressionLevel]::Optimal)
        $in.CopyTo($gz)
        $gz.Dispose(); $out.Dispose(); $in.Dispose()
        Remove-Item $temp -Force
    }
}
finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

$size = (Get-Item $file).Length
Write-Host "[$(Get-Date)] backup done → $file ($([math]::Round($size/1MB,2)) MB)"

# 清理 retention 外的旧文件
$cutoff = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem -Path $BackupDir -Filter "integration-*.sql.gz" -File |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object {
        Remove-Item $_.FullName -Force
        Write-Host "[$(Get-Date)] cleaned old backup: $($_.Name)"
    }

Write-Host "[$(Get-Date)] retention cleanup done (keep $RetentionDays days)"
