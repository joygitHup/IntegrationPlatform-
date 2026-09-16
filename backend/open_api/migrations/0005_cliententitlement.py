from django.db import migrations, models


def backfill_entitlements(apps, schema_editor):
    """存量集成商：以凭证上的旧月度配额初始化授权；资源数/席位默认 0=不限。"""
    IntegrationClient = apps.get_model("open_api", "IntegrationClient")
    ClientEntitlement = apps.get_model("open_api", "ClientEntitlement")
    for client in IntegrationClient.objects.all():
        if ClientEntitlement.objects.filter(client_id=client.id).exists():
            continue
        ClientEntitlement.objects.create(
            id=f"ent_{client.id[3:]}" if client.id.startswith("ic_") else f"ent_{client.id}",
            client_id=client.id,
            max_jobs=0,
            max_seats=0,
            max_connectors=0,
            max_rows_monthly=int(client.monthly_row_quota or 0),
            max_api_calls_monthly=int(client.monthly_call_quota or 0),
        )


def reverse_noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("open_api", "0004_workspace_usage"),
    ]

    operations = [
        migrations.CreateModel(
            name="ClientEntitlement",
            fields=[
                ("id", models.CharField(editable=False, max_length=64, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("client_id", models.CharField(db_index=True, max_length=32, unique=True)),
                ("max_jobs", models.IntegerField(default=0)),
                ("max_seats", models.IntegerField(default=0)),
                ("max_connectors", models.IntegerField(default=0)),
                ("max_rows_monthly", models.IntegerField(default=0)),
                ("max_api_calls_monthly", models.IntegerField(default=0)),
                ("note", models.CharField(blank=True, default="", max_length=255)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"db_table": "sys_client_entitlements"},
        ),
        migrations.RunPython(backfill_entitlements, reverse_noop),
    ]
