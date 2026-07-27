/**
 * Sobe front (Vite) + backend (Elysia) juntos, em um único processo pai.
 * `bun run dev`
 */
const proc = [
  { name: 'vite ', color: '\x1b[35m', cmd: ['bunx', '--bun', 'vite'] },
  { name: 'elysia', color: '\x1b[36m', cmd: ['bun', 'run', '--watch', 'server/index.ts'] },
]

const children = proc.map(({ name, color, cmd }) => {
  const child = Bun.spawn(cmd, {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...Bun.env, FORCE_COLOR: '1' },
  })

  const pipe = async (stream: ReadableStream<Uint8Array>) => {
    const dec = new TextDecoder()
    for await (const chunk of stream) {
      for (const line of dec.decode(chunk).split('\n')) {
        if (line.trim()) console.log(`${color}[${name}]\x1b[0m ${line}`)
      }
    }
  }
  pipe(child.stdout as ReadableStream<Uint8Array>)
  pipe(child.stderr as ReadableStream<Uint8Array>)
  return child
})

const kill = () => {
  children.forEach((c) => c.kill())
  process.exit(0)
}
process.on('SIGINT', kill)
process.on('SIGTERM', kill)

await Promise.all(children.map((c) => c.exited))
