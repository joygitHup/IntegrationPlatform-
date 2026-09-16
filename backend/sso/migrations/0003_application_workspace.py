from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("sso", "0002_oauthauthorizationcode_oauthstate_ssoauthnrequest_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="application",
            name="workspace_id",
            field=models.CharField(blank=True, db_index=True, default="", max_length=32),
        ),
    ]
