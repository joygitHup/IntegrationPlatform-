from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("jobs", "0004_integrationjob_dag_steps_integrationjob_environment_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="integrationjob",
            name="workspace_id",
            field=models.CharField(blank=True, db_index=True, default="", max_length=32),
        ),
    ]
