FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client curl \
    && rm -rf /var/lib/apt/lists/*

# 先装依赖（利用 Docker layer cache）
COPY requirements.txt requirements-connectors.txt* ./
# requirements-connectors.txt 可能不存在，用 if 跳过
RUN pip install --no-cache-dir -r requirements.txt \
    && (test -f requirements-connectors.txt && pip install --no-cache-dir -r requirements-connectors.txt || true) \
    && pip install --no-cache-dir gunicorn whitenoise

COPY . .

# collectstatic + migrations 在 entrypoint 里做
EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "4"]
