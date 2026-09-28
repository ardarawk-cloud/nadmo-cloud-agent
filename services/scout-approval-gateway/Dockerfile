FROM python:3.12-alpine
WORKDIR /app
COPY server.py /app/server.py
COPY public /app/public
ENV PORT=8788
ENV DB_PATH=/data/scout-approval.sqlite3
EXPOSE 8788
CMD ["python", "/app/server.py"]
