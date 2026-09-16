from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("executions", "0002_workflowrun_jobexecution_step_id_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="SchedulerLease",
            fields=[
                ("name", models.CharField(max_length=64, primary_key=True, serialize=False)),
                ("owner", models.CharField(blank=True, default="", max_length=128)),
                ("expires_at", models.DateTimeField(blank=True, null=True)),
            ],
            options={"db_table": "scheduler_lease"},
        ),
    ]
