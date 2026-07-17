# 🚀 React + Vite + Tailwind CSS v4 Template

A modern, fast, and minimal template to jumpstart your next project with React 19 and Tailwind CSS v4.

## ✨ Features

- ⚡ **Vite 7** - Lightning-fast development and optimized builds
- ⚛️ **React 19** - Utilizing the latest features of the React ecosystem
- 🎨 **Tailwind CSS v4** - Next-generation CSS framework with zero-runtime performance
- 🧭 **React Router 7** - Declarative routing for single-page applications
- 🐻 **Zustand** - Simple and scalable state management
- 🌓 **Dark Mode** - Built-in theme switching system
- 💎 **Lucide React** - Beautifully simple pixel-perfect icons
- 🎨 **Simple Icons** - 3000+ SVG icons for popular brands
- 🏗️ **Shadcn UI Ready** - Configured for easy UI component integration
- 🎭 **Framer Motion** - Production-ready motion library for React

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm, pnpm or yarn

### Installation

```bash
# 1. Clone the repository
git clone <your-repo-url>
cd react-vite-tailwind-shadcn-template

# 2. Install dependencies
npm install

# 3. Start the development server
npm run dev
```

The app will be available at `http://localhost:5173`

## 🛠️ Tech Stack

| Category | Technology |
|----------|-----------|
| **Framework** | React 19 |
| **Build Tool** | Vite 7 |
| **Language** | TypeScript 5.9 |
| **Styling** | Tailwind CSS v4 |
| **Routing** | React Router 7 |
| **State Management** | Zustand |
| **Icons** | Lucide React & Simple Icons |
| **Animations** | Framer Motion |

## 📁 Project Structure

```
├── public/              # Static assets (logos, robots.txt, etc.)
├── src/
│   ├── components/      # Reusable UI components
│   ├── lib/             # Utility functions and configurations
│   ├── pages/           # Application views/pages
│   ├── stores/          # Zustand state management stores
│   ├── App.tsx          # Main application component & routing
│   ├── theme.css        # Tailwind 4 configuration & global styles
│   └── main.tsx         # React entry point
├── index.html           # HTML template
├── package.json         # Dependencies and scripts
└── vite.config.ts       # Vite configuration
```

## 🎨 Customization

### Theme Colors
Edit `src/theme.css` to customize the color palette. This project uses OKLCH colors for better perceptual uniformity.

### Adding UI Components
This project is configured to work with Shadcn UI. You can add components using:
```bash
npx shadcn@latest add <component-name>
```

## 📜 Scripts

- `npm run dev`: Start development server
- `npm run build`: Build for production
- `npm run preview`: Preview production build locally
