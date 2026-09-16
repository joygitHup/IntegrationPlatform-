from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("datasources", "0002_datasource_environment"),
    ]

    operations = [
        migrations.AddField(
            model_name="datasource",
            name="workspace_id",
            field=models.CharField(blank=True, db_index=True, default="", max_length=32),
        ),
    ]
