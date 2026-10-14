# Raspberry Pi deployment

This guide deploys the app on a Raspberry Pi 2 Model B running 32-bit Raspberry Pi OS. It builds the frontend on a Mac, builds the Linux ARM server natively on the Pi, and uses Nginx to serve the frontend and proxy API requests.

The Pi 2 has 1 GB of RAM, so compiling Rust can take a while or fail if memory is tight. Use a reliable power supply and ensure the Pi has several gigabytes of free disk space. If the Rust build is killed for lack of memory, add temporary swap or build from USB storage.

## 1. Build the frontend on the Mac

Install Node.js 20.19 or newer (or 22.12 or newer), then from the repository root run:

```sh
cd frontend
npm ci
npm run build
cd ..
```

The static site is generated in `frontend/dist`. Node.js is not required on the Pi to serve these files.

Copy the built files to the Pi, substituting its hostname or address:

```sh
rsync -av --delete frontend/dist/ pi@<pi-address>:/tmp/jira-tv-dist/
```

## 2. Prepare the Pi and build the server

For broad Pi 2 compatibility, use a 32-bit Raspberry Pi OS image. Confirm the OS is 32-bit ARM:

```sh
uname -m
getconf LONG_BIT
```

Expected results are `armv7l` and `32`. Update the system and install the native build tools and Nginx:

```sh
sudo apt update
sudo apt upgrade
sudo apt install build-essential pkg-config nginx rsync
```

Install Rust 1.85 or newer. If the OS package is too old, install rustup:

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

Then clone the repository on the Pi (or pull the latest changes into its existing checkout) and build the release binary:

```sh
git clone YOUR_REPOSITORY_URL ~/Jira-TV
cd ~/Jira-TV/server
rustc --version
cargo build --release --locked
```

The executable will be at `server/target/release/jira-tv-server`. Cargo embeds the SQL migrations in the binary during compilation, so the migrations do not need to be copied separately.

## 3. Install the application files

Create a dedicated service account and install directories:

```sh
sudo useradd --system --home-dir /var/lib/jira-tv --create-home --shell /usr/sbin/nologin jira-tv
sudo install -d -o root -g root /opt/jira-tv/bin
sudo install -d -o jira-tv -g jira-tv /var/lib/jira-tv
sudo install -d -o root -g www-data /var/www/jira-tv
```

Install the release binary and the frontend files:

```sh
sudo install -o root -g root -m 0755 \
  ~/Jira-TV/server/target/release/jira-tv-server \
  /opt/jira-tv/bin/jira-tv-server
sudo rsync -a --delete /tmp/jira-tv-dist/ /var/www/jira-tv/
```

## 4. Configure the Rust service

Create `/etc/jira-tv.env`:

```sh
sudo nano /etc/jira-tv.env
```

Set the household timezone and persistent database location:

```ini
HOUSEHOLD_TIMEZONE=Europe/London
BIND_ADDRESS=127.0.0.1:3000
DATABASE_PATH=/var/lib/jira-tv/planner.db
```

Set permissions so the service account can read the configuration:

```sh
sudo chown root:jira-tv /etc/jira-tv.env
sudo chmod 640 /etc/jira-tv.env
```

Create `/etc/systemd/system/jira-tv.service`:

```ini
[Unit]
Description=Jira TV planner API
After=network.target

[Service]
User=jira-tv
Group=jira-tv
WorkingDirectory=/opt/jira-tv
EnvironmentFile=/etc/jira-tv.env
ExecStart=/opt/jira-tv/bin/jira-tv-server
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now jira-tv
sudo systemctl status jira-tv
```

The API listens only on the Pi's loopback interface; Nginx will forward requests to it.

## 5. Configure Nginx

Create `/etc/nginx/sites-available/jira-tv`:

```nginx
server {
    listen 80 default_server;
    server_name _;

    root /var/www/jira-tv;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Enable the site. If Nginx's default site is still enabled, disable its symlink to avoid competing default sites:

```sh
sudo ln -s /etc/nginx/sites-available/jira-tv /etc/nginx/sites-enabled/jira-tv
if [ -L /etc/nginx/sites-enabled/default ]; then sudo unlink /etc/nginx/sites-enabled/default; fi
sudo nginx -t
sudo systemctl reload nginx
```

## 6. Verify

On the Pi, confirm the API responds through Nginx:

```sh
curl http://127.0.0.1/api/health
```

It should return JSON containing `"status":"ok"`. From another device on the home network, open `http://<pi-address>/`; the TV view is at `http://<pi-address>/tv`. Keep the service restricted to the home network and do not forward its ports from the internet.

## Updating

Rebuild the frontend on the Mac and repeat the `rsync` copy. On the Pi, pull the updated source and rebuild the server:

```sh
cd ~/Jira-TV
git pull
cd server
cargo build --release --locked
sudo systemctl stop jira-tv
sudo install -o root -g root -m 0755 \
  target/release/jira-tv-server \
  /opt/jira-tv/bin/jira-tv-server
sudo systemctl start jira-tv
```

Keep `/var/lib/jira-tv/planner.db` separate from application files and back it up regularly using a SQLite-aware backup method.
