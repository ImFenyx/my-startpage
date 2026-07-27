/**
 * Preload dos testes — carregado automaticamente por `bun test` (bunfig.toml).
 *
 * Garante que NENHUM teste toque no banco real. Sem isto, um `import` de
 * `server/db.ts` sem definir DB_PATH abriria `data/startpage.sqlite` e
 * poluiria os dados do usuário.
 */
import { readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REAL = 'data/startpage.sqlite'

if (!process.env.DB_PATH || process.env.DB_PATH.includes(REAL)) {
  process.env.DB_PATH = join(tmpdir(), `startpage-test-${process.pid}-${Date.now()}.sqlite`)
}

const path = process.env.DB_PATH!

/** Remove o arquivo temporário desta execução. */
function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(path + suffix, { force: true })
    } catch {
      /* ignore */
    }
  }
}
process.on('exit', cleanup)
process.on('beforeExit', cleanup)
process.on('SIGINT', () => {
  cleanup()
  process.exit(130)
})

/**
 * Varre execuções anteriores que não conseguiram limpar (processo morto,
 * crash). Sem isto o /tmp acumula bancos de teste indefinidamente.
 */
try {
  const dir = tmpdir()
  const limite = Date.now() - 10 * 60_000 // mais de 10 minutos
  for (const f of readdirSync(dir)) {
    // cobre tanto os testes unitários quanto o servidor do e2e
    if (!/^(startpage-test|e2e|conc|bench)-/.test(f)) continue
    if (!f.includes('.sqlite')) continue
    const full = join(dir, f)
    try {
      if (statSync(full).mtimeMs < limite) rmSync(full, { force: true })
    } catch {
      /* ignore */
    }
  }
} catch {
  /* ignore */
}
