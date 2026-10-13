from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("open_api", "0005_cliententitlement"),
    ]

    operations = [
        migrations.AddField(
            model_name="cliententitlement",
            name="plan",
            field=models.CharField(
                default="standard",
                max_length=16,
                help_text="订阅计划：trial=试用版 / standard=标准版 / professional=专业版 / enterprise=旗舰私有化",
            ),
        ),
        migrations.AddField(
            model_name="cliententitlement",
            name="expires_at",
            field=models.DateTimeField(
                blank=True,
                help_text="试用版到期时间（到期自动冻结 IntegrationClient.status=frozen）；正式版留空表示永不过期",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="cliententitlement",
            name="plan_features_json",
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text="显式覆写某个 feature 的 gate 结果，例如 {'allow_dag': True}。优先于 plan 默认值",
            ),
        ),
    ]
