from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("sso", "0003_application_workspace"),
    ]

    operations = [
        migrations.AddField(
            model_name="application",
            name="client_id",
            field=models.CharField(blank=True, db_index=True, default="", max_length=32),
        ),
    ]
