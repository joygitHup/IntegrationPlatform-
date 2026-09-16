from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("datasources", "0003_datasource_workspace"),
    ]

    operations = [
        migrations.AddField(
            model_name="datasource",
            name="client_id",
            field=models.CharField(blank=True, db_index=True, default="", max_length=32),
        ),
    ]
