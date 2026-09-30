import path from 'node:path'

export default {
  server: {
    host: true,
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true }
    }
  },
  plugins: [
    {
      name: 'textures-reload',
      configureServer(server) {
        const dir = path.resolve(process.cwd(), 'public', 'textures')
        server.watcher.add(dir)
        const reload = (f) => {
          if (f.replace(/\\/g, '/').includes('/public/textures/')) server.ws.send({ type: 'full-reload' })
        }
        server.watcher.on('change', reload)
        server.watcher.on('add', reload)
      }
    }
  ]
}
