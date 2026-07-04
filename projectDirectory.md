[PROJECT_ROOT]/
├── backend/
│   ├── backups/
│   ├── logs/
│   │   ├── app.log
│   │   ├── database.log
│   │   └── security.log
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── alerts.py
│   │   ├── audit.py
│   │   ├── auth.py
│   │   ├── backup.py
│   │   ├── billing.py
│   │   ├── bookings.py
│   │   ├── branding.py
│   │   ├── features.py
│   │   ├── import_export.py
│   │   ├── inventory.py
│   │   ├── procurement.py
│   │   ├── reports.py
│   │   ├── roles.py
│   │   ├── security.py
│   │   ├── settings.py
│   │   └── users.py
│   ├── venv/                      # Python Virtual Environment (Contents Hidden)
│   ├── alerts.py
│   ├── audit.py
│   ├── auth.py
│   ├── branding.py
│   ├── branding_config.enc
│   ├── config.py
│   ├── database.py
│   ├── hotel_mess.db              # SQLite Database Configuration
│   ├── logging_config.py
│   ├── main.py                    # FastAPI Entrypoint
│   ├── models.py                  # SQLAlchemy / SQLModel Data Definitions
│   └── schemas.py                 # Pydantic Schemas
│
├── node_modules/                  # Frontend Node Package Directory (Contents Hidden)
│
├── src/
│   ├── components/
│   │   ├── ui/                    # Shadcn / Tailwind Modular UI Primitives
│   │   │   ├── accordion.tsx
│   │   │   ├── alert-dialog.tsx
│   │   │   ├── alert.tsx
│   │   │   ├── aspect-ratio.tsx
│   │   │   ├── avatar.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── breadcrumb.tsx
│   │   │   ├── button-group.tsx
│   │   │   ├── button.tsx
│   │   │   ├── calendar.tsx
│   │   │   ├── card.tsx
│   │   │   ├── carousel.tsx
│   │   │   ├── chart.tsx
│   │   │   ├── checkbox.tsx
│   │   │   ├── collapsible.tsx
│   │   │   ├── command.tsx
│   │   │   ├── context-menu.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── drawer.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── empty.tsx
│   │   │   ├── field.tsx
│   │   │   ├── form.tsx
│   │   │   ├── hover-card.tsx
│   │   │   ├── input-group.tsx
│   │   │   ├── input-otp.tsx
│   │   │   ├── input.tsx
│   │   │   ├── item.tsx
│   │   │   ├── kbd.tsx
│   │   │   ├── label.tsx
│   │   │   ├── menubar.tsx
│   │   │   ├── navigation-menu.tsx
│   │   │   ├── pagination.tsx
│   │   │   ├── popover.tsx
│   │   │   ├── progress.tsx
│   │   │   ├── radio-group.tsx
│   │   │   ├── resizable.tsx
│   │   │   ├── scroll-area.tsx
│   │   │   ├── select.tsx
│   │   │   ├── separator.tsx
│   │   │   ├── sheet.tsx
│   │   │   ├── sidebar.tsx
│   │   │   ├── skeleton.tsx
│   │   │   ├── slider.tsx
│   │   │   ├── sonner.tsx
│   │   │   ├── spinner.tsx
│   │   │   ├── switch.tsx
│   │   │   ├── table.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── textarea.tsx
│   │   │   ├── toggle-group.tsx
│   │   │   ├── toggle.tsx
│   │   │   └── tooltip.tsx
│   │   ├── Layout.tsx
│   │   └── SAMBadge.tsx
│   ├── contexts/
│   │   ├── AuthContext.tsx
│   │   ├── FeaturesContext.tsx
│   │   └── ThemeContext.tsx
│   ├── hooks/
│   │   └── use-mobile.ts
│   ├── lib/
│   │   ├── api.ts                 # Axios / Fetch HTTP Orchestrator
│   │   └── utils.ts
│   ├── pages/
│   │   ├── Alerts.tsx
│   │   ├── AuditLog.tsx
│   │   ├── Billing.tsx
│   │   ├── Bookings.tsx
│   │   ├── Dashboard.tsx
│   │   ├── Home.tsx
│   │   ├── ImportExport.tsx
│   │   ├── Inventory.tsx
│   │   ├── Login.tsx
│   │   ├── NotFound.tsx
│   │   ├── Procurement.tsx
│   │   ├── Reports.tsx
│   │   ├── Roles.tsx
│   │   ├── Security.tsx
│   │   ├── Settings.tsx
│   │   ├── SplashScreen.tsx
│   │   └── Users.tsx
│   ├── App.css
│   ├── App.tsx                    # React Root Router & Context Providers
│   ├── index.css
│   └── main.tsx                   # Client Application Mount Entrypoint
│
├── .gitignore
├── components.json                # UI Initialization Profile Configuration
├── eslint.config.js
├── index.html
├── info.md
├── INSTALL.md
├── package-lock.json
├── package.json
├── postcss.config.js
├── README.md
├── start.bat                      # Local Windows Launcher Script
├── start.sh                       # Local Unix Launcher Script
├── tailwind.config.js             # Styling Configuration System Design Parameters
├── tsconfig.app.json
├── tsconfig.json
├── tsconfig.node.json
└── vite.config.ts                 # Dev Server Build Systems Parameters