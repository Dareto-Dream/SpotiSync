# Spotify Jam Mode - Backend

Backend server for Spotify Jam Mode collaborative listening application.

## Quick Start

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Configure environment (copy `.env.example` to `.env` and fill in values)

3. Run migrations:
```bash
python src/database/migrate.py
```

4. Start server:
```bash
python src/server.py
```

## Environment Variables

See `.env.example` for all required configuration.

## Documentation

See main `DOC.md` and `API_STANDARDS.md` in project root.
