from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("iam", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="client_id",
            field=models.CharField(blank=True, db_index=True, default="", max_length=32),
        ),
    ]
