FROM mcr.microsoft.com/playwright/python:v1.49.0-noble

WORKDIR /app

COPY requirements-server.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY survey_bot.py app.py storage.py ./
COPY public ./public

ENV PORT=8000
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data
EXPOSE 8000

CMD uvicorn app:app --host 0.0.0.0 --port ${PORT}
