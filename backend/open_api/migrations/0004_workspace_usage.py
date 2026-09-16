from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("open_api", "0003_client_security"),
    ]

    operations = [
        migrations.AddField(
            model_name="integrationclient",
            name="monthly_call_quota",
            field=models.IntegerField(default=0),
        ),
        migrations.AddField(
            model_name="integrationclient",
            name="monthly_row_quota",
            field=models.IntegerField(default=0),
        ),
        migrations.AddField(
            model_name="integrationclient",
            name="sandbox",
            field=models.BooleanField(default=False),
        ),
        migrations.CreateModel(
            name="PartnerWorkspace",
            fields=[
                ("id", models.CharField(editable=False, max_length=64, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("client_id", models.CharField(db_index=True, max_length=32)),
                ("name", models.CharField(max_length=128)),
                ("code", models.CharField(max_length=64)),
                ("environment", models.CharField(blank=True, default="", max_length=16)),
                ("status", models.CharField(default="active", max_length=16)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"db_table": "sys_partner_workspaces", "unique_together": {("client_id", "code")}},
        ),
        migrations.CreateModel(
            name="ClientUsageDaily",
            fields=[
                ("id", models.CharField(editable=False, max_length=64, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("client_id", models.CharField(db_index=True, max_length=32)),
                ("day", models.DateField()),
                ("api_calls", models.IntegerField(default=0)),
                ("rows_written", models.IntegerField(default=0)),
            ],
            options={"db_table": "sys_client_usage_daily", "unique_together": {("client_id", "day")}},
        ),
        migrations.CreateModel(
            name="IdempotencyRecord",
            fields=[
                ("id", models.CharField(editable=False, max_length=64, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("scope", models.CharField(db_index=True, max_length=64)),
                ("key", models.CharField(max_length=128)),
                ("path", models.CharField(blank=True, default="", max_length=200)),
                ("status_code", models.IntegerField(default=200)),
                ("response_json", models.JSONField(default=dict)),
                ("expires_at", models.DateTimeField(blank=True, null=True)),
            ],
            options={"db_table": "sys_idempotency_keys", "unique_together": {("scope", "key")}},
        ),
    ]
