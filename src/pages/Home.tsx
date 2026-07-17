import reactLogo from '/react.svg'
import viteLogo from '/vite.svg'
import tailwindLogo from '/tailwind.svg'
import shadcnLogo from '/shadcn-ui.svg'
import { useAppStore } from '../stores/useAppStore'
import { Sun, Moon } from 'lucide-react'
import { Button } from '../components/ui/button'
import { motion } from 'framer-motion'

function Home() {
  const { theme, toggleTheme } = useAppStore()

  return (
    <>
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center">
        <motion.div className="absolute top-4 left-4"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5 }}
        >
          <motion.button
            onClick={() => {
              toggleTheme()
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card text-foreground hover:bg-muted px-3 py-2 text-sm transition-colors"
            aria-label="Toggle theme"
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <motion.div
              key={theme}
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </motion.div>
            <span className="font-medium">{theme === 'light' ? 'Dark' : 'Light'}</span>
          </motion.button>
        </motion.div>

        <motion.div
          className="flex space-x-4 mb-8"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: { opacity: 0 },
            visible: {
              opacity: 1,
              transition: {
                staggerChildren: 0.2
              }
            }
          }}
        >
           <motion.a href="https://vite.dev" target="_blank"
             variants={{
               hidden: { opacity: 0, y: 20 },
               visible: { opacity: 1, y: 0 }
             }}
           >
             <motion.img src={viteLogo} className="h-16 w-16" alt="Vite logo"
               animate={{ scale: [1, 1.05, 1] }}
               transition={{ duration: 3, repeat: Infinity }}
               whileHover={{ scale: 1.1 }}
               whileTap={{ scale: 0.95 }}
             />
           </motion.a>
           <motion.a href="https://react.dev" target="_blank"
             variants={{
               hidden: { opacity: 0, y: 20 },
               visible: { opacity: 1, y: 0 }
             }}
           >
             <motion.img src={reactLogo} className="h-16 w-16" alt="React logo"
               animate={{ scale: [1, 1.05, 1] }}
               transition={{ duration: 3, repeat: Infinity, delay: 0.5 }}
               whileHover={{ scale: 1.1 }}
               whileTap={{ scale: 0.95 }}
             />
           </motion.a>
           <motion.a href="https://tailwindcss.com/" target="_blank"
             variants={{
               hidden: { opacity: 0, y: 20 },
               visible: { opacity: 1, y: 0 }
             }}
           >
             <motion.img src={tailwindLogo} className="h-16 w-16" alt="Tailwind logo"
               animate={{ scale: [1, 1.05, 1] }}
               transition={{ duration: 3, repeat: Infinity, delay: 1 }}
               whileHover={{ scale: 1.1 }}
               whileTap={{ scale: 0.95 }}
             />
           </motion.a>
           <motion.a href="https://shadcn.com/" target="_blank"
             variants={{
               hidden: { opacity: 0, y: 20 },
               visible: { opacity: 1, y: 0 }
             }}
           >
             <motion.img src={shadcnLogo} className="h-16 w-16" alt="Shadcn logo"
               animate={{ scale: [1, 1.05, 1] }}
               transition={{ duration: 3, repeat: Infinity, delay: 2 }}
               whileHover={{ scale: 1.1 }}
               whileTap={{ scale: 0.95 }}
             />
           </motion.a>
         </motion.div>

        <motion.div className="mb-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1 }}
        >
          <motion.div
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Button>Hello</Button>
          </motion.div>
        </motion.div>

        <motion.div
          className="text-lg font-medium opacity-80 space-y-1 text-center"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: { opacity: 0 },
            visible: {
              opacity: 1,
              transition: {
                delayChildren: 1.2,
                staggerChildren: 0.1
              }
            }
          }}
        >
          <motion.a href="https://www.npmjs.com/package/vite" target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-primary transition-colors underline block"
            variants={{
              hidden: { opacity: 0, x: -20 },
              visible: { opacity: 1, x: 0 }
            }}
          >Vite</motion.a>
          <motion.a href="https://www.npmjs.com/package/react" target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-primary transition-colors underline block"
            variants={{
              hidden: { opacity: 0, x: -20 },
              visible: { opacity: 1, x: 0 }
            }}
          >React</motion.a>
          <motion.a href="https://www.npmjs.com/package/tailwindcss" target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-primary transition-colors underline block"
            variants={{
              hidden: { opacity: 0, x: -20 },
              visible: { opacity: 1, x: 0 }
            }}
          >Tailwind CSS</motion.a>
          <motion.a href="https://www.npmjs.com/package/shadcn-ui" target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-primary transition-colors underline block"
            variants={{
              hidden: { opacity: 0, x: -20 },
              visible: { opacity: 1, x: 0 }
            }}
          >Shadcn UI</motion.a>
          <motion.a href="https://www.npmjs.com/package/react-router-dom" target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-primary transition-colors underline block"
            variants={{
              hidden: { opacity: 0, x: -20 },
              visible: { opacity: 1, x: 0 }
            }}
          >React Router DOM</motion.a>
          <motion.a href="https://www.npmjs.com/package/zustand" target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-primary transition-colors underline block"
            variants={{
              hidden: { opacity: 0, x: -20 },
              visible: { opacity: 1, x: 0 }
            }}
          >Zustand</motion.a>
          <motion.a href="https://www.npmjs.com/package/lucide-react" target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-primary transition-colors underline block"
            variants={{
              hidden: { opacity: 0, x: -20 },
              visible: { opacity: 1, x: 0 }
            }}
          >Lucide React</motion.a>
          <motion.a href="https://simpleicons.org/" target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-primary transition-colors underline block"
            variants={{
              hidden: { opacity: 0, x: -20 },
              visible: { opacity: 1, x: 0 }
            }}
          >Simple Icons</motion.a>
          <motion.div className="text-foreground"
            variants={{
              hidden: { opacity: 0, x: -20 },
              visible: { opacity: 1, x: 0 }
            }}
          >Theme Toggle</motion.div>
          <motion.div className="text-foreground"
            variants={{
              hidden: { opacity: 0, x: -20 },
              visible: { opacity: 1, x: 0 }
            }}
          >Comprehensive .gitignore</motion.div>
        </motion.div>
      </div>
    </>
  )
}

export default Home