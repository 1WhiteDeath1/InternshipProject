# SAM Hotel & Mess Management System - Installation Guide

## Overview

This is a **100% offline, locally-hosted** Hotel & Mess Management System designed for on-premise deployment. All data stays within your network. No internet connection is required after installation. No data ever leaves your building.

## System Requirements

### Server Machine (the computer that runs the application)

- **Operating System:** Windows 10/11, or Linux (Ubuntu 20.04+, Debian 10+, CentOS 8+)
- **RAM:** 4 GB minimum (8 GB recommended)
- **Storage:** 2 GB free space minimum
- **Network:** Ethernet or Wi-Fi connection to your local network
- **Python:** Version 3.10 or higher

### Client Devices (devices that connect to the system)

- Any device with a modern web browser (Chrome, Firefox, Edge, Safari)
- Connected to the **same local network** as the server
- No software installation required on client devices

## Prerequisites Installation

### Windows

1. Install Python 3.10+ from https://python.org/downloads/
   - During installation, check **"Add Python to PATH"**
2. Open Command Prompt and verify:
   ```
   python --version
   ```

### Linux

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install python3 python3-pip

# Verify
python3 --version
```

## Installation Steps

### Step 1: Extract the Application

Extract the application folder to your desired location, for example:
- Windows: `C:\sam-hotel\`
- Linux: `/opt/sam-hotel/`

### Step 2: Install Dependencies

Open a terminal/command prompt in the application folder:

```bash
# Windows
pip install -r requirements.txt

# Linux
pip3 install -r requirements.txt
```

> `rapidocr-onnxruntime` powers the receipt-scanning "Smart Intake" feature in Inventory & Procurement. It bundles its own OCR models (~15MB) via ONNX Runtime — no separate system install or admin rights required, unlike Tesseract. First use after install takes ~1s to warm up the model; after that it's instant.

### Step 3: Seed Demo Data (Optional)

To populate the system with sample data for testing:

```bash
# Windows
python backend/seed_demo.py

# Linux
python3 backend/seed_demo.py
```

This creates:
- 1 Supervisor account: `admin` / `admin123`
- 4 Staff accounts with different roles
- Sample inventory, rooms, bookings, vendors, and more

### Step 4: Start the Server

**Windows:** Double-click `start.bat` or run:
```
start.bat
```

**Linux:** Run:
```bash
./start.sh
```

The server will start on port 8000.

## Accessing the Application

### On the Server Machine

Open your web browser and go to:
```
http://localhost:8000
```

### On Other Devices (Same Network)

1. Find your server's local IP address:
   - **Windows:** Open Command Prompt and run `ipconfig`
   - **Linux:** Open terminal and run `ip addr` or `ifconfig`
   - Look for something like `192.168.1.xxx`

2. On any other device connected to the same network, open a web browser and enter:
   ```
   http://192.168.1.xxx:8000
   ```
   (Replace `192.168.1.xxx` with your server's actual IP address)

### First Login

After seeding demo data, use these credentials:
- **Username:** `admin`
- **Password:** `admin123`

## Daily Operation

### Starting the Server

- **Windows:** Double-click `start.bat`
- **Linux:** Run `./start.sh` in the terminal

### Stopping the Server

- Close the terminal window, or press `Ctrl+C` in the terminal

### Default Login Credentials (after seeding)

| Username    | Password     | Role                |
|-------------|--------------|---------------------|
| admin       | admin123     | Supervisor          |
| frontdesk1  | front123     | Front Desk          |
| kitchen1    | kitchen123   | Kitchen Clerk       |
| procurement1| procure123   | Procurement Officer |
| security1   | security123  | Night Security      |

## Backup

### Automatic Backups
The system can be configured to perform automatic nightly backups. Configure this in Settings > Backup.

### Manual Backups
Supervisors can create manual backups from Settings > Backup. Backups are saved as ZIP files containing the entire database.

### Finding Backup Files
- Windows: `backend/backups/`
- Linux: `backend/backups/`

To restore from a backup, extract the ZIP file and replace `hotel_mess.db` with the backed-up database file.

## Troubleshooting

### "Port 8000 is already in use"
Change the port in the start script: add `--port 8080` (or any available port).

### "Cannot connect from other devices"
1. Check Windows Firewall / Linux firewall settings
2. Ensure the server is started with `--host 0.0.0.0` (this is the default in our scripts)
3. Verify both devices are on the same network

### "Python not found"
Ensure Python is installed and added to your system PATH.

### "Module not found" errors
Re-run the pip install command to ensure all dependencies are installed.

## Support

For technical support, contact the system developer.

---

**Developed by SAM Technologies**
**Version 1.0.0**
