import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  // Base path for GitHub Pages (replace 'piggy' with your repo name if different)
  // Or use process.env.BASE_URL if you inject it.
  // For now, let's leave it dynamic or default.
  // If user deploys to username.github.io/piggy, base should be '/piggy/'.
  // We'll set it to './' to be relative, which often works for simple apps,
  // BUT client-side routing (BrowserRouter) normally needs absolute paths or HasRouter.
  // Let's stick to standard build and advise user.
  // Actually, strictly safer to use '/' unless specified.
})
