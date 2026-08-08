import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the app works on GitHub Pages under any repo path
export default defineConfig({
  base: './',
  plugins: [react()],
})
