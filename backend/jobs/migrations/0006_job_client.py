from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("jobs", "0005_job_workspace"),
    ]

    operations = [
        migrations.AddField(
            model_name="integrationjob",
            name="client_id",
            field=models.CharField(blank=True, db_index=True, default="", max_length=32),
        ),
    ]
