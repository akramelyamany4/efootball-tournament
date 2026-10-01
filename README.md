# EFOOTBALL CUP

## Run locally

Install Node.js 18 or newer, then run:

```sh
npm start
```

Open `http://127.0.0.1:4173` for the tournament and `http://127.0.0.1:4173/admin` for administration. On first local access, create an administrator password of at least 12 characters. Setup is only available from this computer and only while no administrator is configured.

## Tournament data

The public page and admin editor use the same API. Tournament changes are saved to `data/tournament.json` and remain after a server restart. The administrator password created during local setup is stored as a salted scrypt hash in `data/admin.json`; that file is excluded from version control.

## Hosting

Run the Node server behind an HTTPS reverse proxy. Set `NODE_ENV=production`, provide a secret `ADMIN_PASSWORD` of at least 12 characters through the host's environment settings, and mount persistent storage at the project's `data` directory. The server uses the platform's `PORT` and binds to `0.0.0.0` in production by default. Do not expose the server over plain HTTP on a public network.