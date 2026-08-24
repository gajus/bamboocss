import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import bamboocss from '@bamboocss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), bamboocss()],
})
