# Project Rules

This document defines the coding standards and constraints for this React + Vite + Tailwind CSS + shadcn/ui template.

## Table of Contents

- [Styling](#styling)
- [Components](#components)
- [State Management](#state-management)
- [Project Structure](#project-structure)
- [Imports](#imports)
- [Icons](#icons)
- [Animations](#animations)

---

## Styling

### 1. Tailwind CSS Only

- **Use Tailwind utility classes for all styling needs.**
- **Never write custom CSS in `theme.css`** except for CSS variable definitions.
- **Never create `.css` files** for component-specific styles.

```tsx
// ✅ Good
<div className="flex items-center justify-between p-4 bg-card rounded-lg">

// ❌ Bad
<div className="my-custom-class">
// And then defining .my-custom-class in a separate CSS file
```

### 2. Theme Customization

The `src/theme.css` file contains CSS variables for theming. You may:

- Modify CSS variable values in `:root` and `.dark`
- Add new CSS variables if needed

You may NOT:

- Add custom CSS classes or rules
- Add `@apply` directives
- Add arbitrary CSS that belongs in component files

```css
/* ✅ Good - modifying CSS variables */
:root {
  --primary: oklch(0.6 0.2 250); /* Changed from default */
}

/* ❌ Bad - adding custom CSS rules */
.my-button {
  background: var(--primary);
  padding: 8px 16px;
}
```

### 3. Tailwind v4 Syntax

This project uses Tailwind CSS v4 with the `@theme inline` syntax. Theme values are mapped from CSS variables:

```css
@theme inline {
  --color-background: var(--background);
  --color-primary: var(--primary);
  /* ... */
}
```

Use the theme colors via Tailwind classes:

```tsx
// ✅ Good - using theme colors
<div className="bg-background text-foreground">
<div className="bg-primary text-primary-foreground">
<div className="border-border">
```

### 4. Class Name Ordering

For consistency, organize Tailwind classes in this order:

1. Layout (display, position, overflow, etc.)
2. Box Model (width, height, padding, margin, border)
3. Typography (font, text, line-height)
4. Visual (background, color, shadow)
5. Transitions & Animation
6. Interactivity (cursor, hover, focus, etc.)

```tsx
// ✅ Good - organized class order
<button className="flex items-center h-10 px-4 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
```

### 5. Dynamic Classes with `cn()`

Always use the `cn()` utility from `@/lib/utils` for conditional or merged classes:

```tsx
import { cn } from "@/lib/utils"

// ✅ Good
<button className={cn(
  "flex items-center h-10 px-4",
  variant === "primary" && "bg-primary",
  isActive && "ring-2 ring-ring",
  className
)}>
```

---

## Components

### 1. Always Use shadcn/ui First

**Before building any custom component, check if shadcn/ui has it.**

The shadcn/ui registry includes many pre-built components (dialog, dropdown, tabs, table, etc.). Always prefer these over building from scratch.

```tsx
// ✅ Good - using shadcn Dialog
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

// ❌ Bad - building custom modal from scratch
function MyCustomModal({ isOpen, onClose, children }) {
  return <div className="fixed inset-0...">{children}</div>
}
```

### 2. Component Decision Checklist

Before creating any UI element, go through this checklist:

1. **Is it in shadcn/ui?** → Use `npx shadcn add <component>`
2. **Is it a combination of shadcn components?** → Compose existing shadcn components
3. **Only if not available** → Build a custom component using shadcn patterns

```tsx
// ✅ Good - composing shadcn components
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

function UserCard({ user }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{user.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <Button>View Profile</Button>
      </CardContent>
    </Card>
  )
}

// ❌ Bad - building from divs when Card exists
function UserCard({ user }) {
  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <div className="p-6">
        <h3 className="font-semibold">{user.name}</h3>
      </div>
    </div>
  )
}
```

### 4. Add shadcn Components via CLI

**Always use the CLI to add components:**

```bash
npx shadcn add button
npx shadcn add card dialog input
```

**Never manually create shadcn/ui components** - always use the CLI to ensure:
- Proper styling with Tailwind v4
- Correct accessibility attributes
- Consistent patterns
- Proper Radix UI integration

### 2. Component Location

- **shadcn/ui components**: `src/components/ui/`
- **Custom components**: `src/components/`
- **Page components**: `src/pages/`

### 3. Component Structure

Follow the existing pattern for shadcn/ui components:

```tsx
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center",
  {
    variants: {
      variant: { /* ... */ },
      size: { /* ... */ },
    },
  }
)

function Button({ className, variant, size, ...props }) {
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
```

### 4. Props Interface

Always define props interface, extending `React.ComponentProps` when appropriate:

```tsx
interface ButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}
```

---

## State Management

### 1. Zustand for Global State

Use Zustand for global state management. Stores should be in `src/stores/`:

```tsx
// src/stores/useAppStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AppState {
  theme: 'light' | 'dark'
  setTheme: (theme: 'light' | 'dark') => void
  toggleTheme: () => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set({ theme: get().theme === 'light' ? 'dark' : 'light' }),
    }),
    { name: 'app-store' },
  ),
)
```

### 2. Local State with React Hooks

Use React's built-in hooks for local component state:

```tsx
const [isOpen, setIsOpen] = React.useState(false)
const [count, setCount] = React.useState(0)
```

---

## Project Structure

```
src/
├── components/
│   ├── ui/           # shadcn/ui components (auto-generated)
│   └── ...           # Custom reusable components
├── pages/            # Page/route components
├── stores/           # Zustand stores
├── lib/
│   └── utils.ts      # Utility functions (cn, etc.)
├── theme.css         # Tailwind theme variables (CSS only)
├── main.tsx          # App entry point
└── App.tsx           # Root component
```

---

## Imports

### 1. Path Aliases

Always use the `@/` alias for imports:

```tsx
// ✅ Good
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/stores/useAppStore"

// ❌ Bad
import { Button } from "../components/ui/button"
import { cn } from "../lib/utils"
```

### 2. Import Order

Organize imports in this order:

1. React imports
2. Third-party libraries
3. `@/` imports (components, hooks, utils, stores)
4. Relative imports (when necessary)
5. Type imports

```tsx
// ✅ Good
import * as React from "react"
import { useState } from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/stores/useAppStore"

import type { VariantProps } from "class-variance-authority"
```

---

## Icons

### 1. Lucide Icons (Primary)

The project is configured to use [Lucide React](https://lucide.dev/) for icons:

```tsx
import { Sun, Moon, Check, X, ChevronRight } from 'lucide-react'
```

### 2. Simple Icons (Brand Icons)

Use [Simple Icons](https://simpleicons.org/) for brand logos:

```tsx
import { siReact, siVite } from 'simple-icons'
```

### 3. Icon Sizing

Use Tailwind size utilities for consistent icon sizing:

```tsx
// ✅ Good
<Icon className="size-4" />     // Small
<Icon className="size-5" />     // Default
<Icon className="size-6" />     // Large
<Icon className="size-8" />     // Extra large
```

---

## Animations

### 1. Framer Motion (Primary)

The project includes [Framer Motion](https://www.framer.com/motion/) for animations. **Always consider adding animations** where appropriate to enhance UX.

**Common use cases:**
- Page/screen transitions
- Modal/dialog open/close animations
- List item entrance animations
- Hover/tap interactions
- Layout animations
- Scroll-triggered animations

```tsx
// ✅ Good - simple fade in animation
import { motion } from "framer-motion"

function Card({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="rounded-lg border bg-card p-6"
    >
      {children}
    </motion.div>
  )
}

// ✅ Good - staggered list animation
import { motion } from "framer-motion"

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, x: -20 },
  show: { opacity: 1, x: 0 },
}

function ItemList({ items }) {
  return (
    <motion.ul
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      {items.map((item) => (
        <motion.li key={item.id} variants={itemVariants}>
          {item.name}
        </motion.li>
      ))}
    </motion.ul>
  )
}
```

### 2. Animation Guidelines

**Do:**
- Use subtle, purposeful animations that guide attention
- Keep animations performant (use `transform` and `opacity` when possible)
- Use consistent timing (0.2s - 0.4s for micro-interactions)

**Don't:**
- Over-animate to the point of distraction
- Block user interactions with long animations
- Use heavy animations on low-end devices without testing

```tsx
// ✅ Good - reduced motion support
import { motion, useReducedMotion } from "framer-motion"

function AnimatedButton() {
  const shouldReduceMotion = useReducedMotion()

  return (
    <motion.button
      whileHover={shouldReduceMotion ? {} : { scale: 1.05 }}
      whileTap={shouldReduceMotion ? {} : { scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
    >
      Click me
    </motion.button>
  )
}
```

### 3. AnimatePresence for Exit Animations

Use `AnimatePresence` when components need exit animations (removing from DOM):

```tsx
// ✅ Good - modal with enter/exit animation
import { motion, AnimatePresence } from "framer-motion"

function Modal({ isOpen, onClose, children }) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/50"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card p-6 rounded-lg"
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Add shadcn component | `npx shadcn add <component>` |
| Run dev server | `npm run dev` |
| Build for production | `npm run build` |
| Preview production build | `npm run preview` |

---

## Summary

- ✅ Use Tailwind utility classes for all styling
- ✅ Always check shadcn/ui first before building custom components
- ✅ Use `npx shadcn add` for new UI components
- ✅ Use `@/` path aliases for imports
- ✅ Use `cn()` for class merging
- ✅ Use Lucide icons from `lucide-react`
- ✅ Use Zustand for global state
- ✅ Use Framer Motion for animations where appropriate
- ✅ Modify CSS variables in `theme.css` only
- ❌ Never add custom CSS rules to `theme.css`
- ❌ Never create separate `.css` files for components
- ❌ Never manually create shadcn/ui components
