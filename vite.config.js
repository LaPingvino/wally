import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { wasm } from '@rollup/plugin-wasm';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill';
import inject from '@rollup/plugin-inject';
import topLevelAwait from 'vite-plugin-top-level-await';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'fs';
import path from 'path';
import buildConfig from './build.config';

const copyFiles = {
  targets: [
    {
      src: 'node_modules/@element-hq/element-call-embedded/dist/*',
      dest: 'public/element-call',
    },
    {
      src: 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
      dest: '',
      rename: 'pdf.worker.min.js',
    },
    {
      src: 'netlify.toml',
      dest: '',
    },
    {
      src: 'config.json',
      dest: '',
    },
    {
      src: 'public/manifest.json',
      dest: '',
    },
    {
      src: 'public/res/android',
      dest: 'public/',
    },
    {
      src: 'public/locales',
      dest: 'public/',
    },
  ],
};

function serverMatrixSdkCryptoWasm(wasmFilePath) {
  return {
    name: 'vite-plugin-serve-matrix-sdk-crypto-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === wasmFilePath) {
          const resolvedPath = path.join(
            path.resolve(),
            '/node_modules/@matrix-org/matrix-sdk-crypto-wasm/pkg/matrix_sdk_crypto_wasm_bg.wasm'
          );

          if (fs.existsSync(resolvedPath)) {
            res.setHeader('Content-Type', 'application/wasm');
            res.setHeader('Cache-Control', 'no-cache');

            const fileStream = fs.createReadStream(resolvedPath);
            fileStream.pipe(res);
          } else {
            res.writeHead(404);
            res.end('File not found');
          }
        } else {
          next();
        }
      });
    },
  };
}

// Patch Element Call to accept a pre-issued LiveKit JWT via URL parameter.
// When livekitToken + livekitUrl are in the URL query, EC skips the normal
// OpenID → lk-jwt-service exchange and uses the provided token directly.
// This enables guest (non-Matrix) users to join calls via Wally Conference bot.
// Inert when livekitToken is absent — zero behavioral change for normal users.
// Patches EC source in node_modules BEFORE viteStaticCopy copies it to dist.
function patchElementCallGuestJWT() {
  return {
    name: 'patch-element-call-guest-jwt',
    enforce: 'pre',
    buildStart() {
      const ecDir = path.join(path.resolve(), 'node_modules/@element-hq/element-call-embedded/dist/assets');
      if (!fs.existsSync(ecDir)) return;
      for (const file of fs.readdirSync(ecDir)) {
        if (!file.endsWith('.js')) continue;
        const filePath = path.join(ecDir, file);
        let content = fs.readFileSync(filePath, 'utf-8');
        // Match the async function that calls getOpenIdToken() — the JWT acquisition function.
        // Pattern: opening brace, variable declaration, try block calling getOpenIdToken.
        // We inject a URL param check right after the opening brace so it returns early
        // before the OpenID exchange when a pre-issued token is present.
        const marker = 'async()=>t.getOpenIdToken()';
        if (!content.includes(marker)) continue;
        let patched = false;

        // Patch 1: Widget mode — intercept OpenID token exchange
        if (!content.includes('livekitToken')) {
          const re = /\{(let \w+;try\{\w+=await \w+\(async\(\)=>t\.getOpenIdToken\(\)\))/;
          const m = content.match(re);
          if (m) {
            const guestCheck = [
              'const _wp=new URLSearchParams(window.location.search);',
              'const _wj=_wp.get("livekitToken");',
              'const _wu=_wp.get("livekitUrl");',
              'if(_wj&&_wu){return{url:_wu,jwt:_wj}}',
            ].join('');
            content = content.replace(re, '{' + guestCheck + '$1');
            patched = true;
            console.log(`[patch-ec-guest-jwt] ${file}: widget mode patch applied`);
          }
        }

        // Patch 2: Standalone mode — skip passwordless registration when livekitToken present.
        // The auto-register useEffect has: !y&&!v&&i&&!ut&&(g(!0),h(i)
        // We add a livekitToken check to prevent registration attempt.
        const regMarker = 'Failed to register passwordless user';
        if (content.includes(regMarker) && !content.includes('_wcSkipReg')) {
          // Find the useEffect that auto-registers: pattern is the condition before h(i)
          // We replace the condition to also check for livekitToken absence
          const regRe = /(\.useEffect\(\(\)=>\{)(!(\w+)&&!(\w+)&&(\w+)&&!(\w+)&&\()/;
          const regM = content.match(regRe);
          if (regM) {
            const replacement = `$1const _wcSkipReg=new URLSearchParams(window.location.search).has("livekitToken");if(!_wcSkipReg){$2`;
            // We also need to close the if block — find the end of the useEffect deps array
            content = content.replace(regRe, replacement);
            // Close the if block before the deps array: find },[ after the .finally(
            const closePoint = content.indexOf('},[', content.indexOf('_wcSkipReg'));
            if (closePoint > 0) {
              content = content.slice(0, closePoint) + '}' + content.slice(closePoint);
            }
            patched = true;
            console.log(`[patch-ec-guest-jwt] ${file}: standalone registration skip applied`);
          } else {
            console.warn(`[patch-ec-guest-jwt] ${file}: found registration marker but regex didn't match`);
          }
        }

        if (patched) {
          fs.writeFileSync(filePath, content);
        } else if (content.includes('livekitToken')) {
          console.log(`[patch-ec-guest-jwt] ${file}: already patched, skipping`);
        }
      }
    },
  };
}

export default defineConfig({
  appType: 'spa',
  publicDir: false,
  base: buildConfig.base,
  server: {
    port: 8080,
    host: true,
    fs: {
      // Allow serving files from one level up to the project root
      allow: ['..'],
    },
  },
  plugins: [
    serverMatrixSdkCryptoWasm('/node_modules/.vite/deps/pkg/matrix_sdk_crypto_wasm_bg.wasm'),
    topLevelAwait({
      // The export name of top-level await promise for each chunk module
      promiseExportName: '__tla',
      // The function to generate import names of top-level await promise in each chunk module
      promiseImportName: (i) => `__tla_${i}`,
    }),
    viteStaticCopy(copyFiles),
    vanillaExtractPlugin(),
    wasm(),
    react(),
    patchElementCallGuestJWT(),
    VitePWA({
      srcDir: 'src',
      filename: 'sw.ts',
      strategies: 'injectManifest',
      injectRegister: false,
      manifest: false,
      injectManifest: {
        injectionPoint: undefined,
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
      plugins: [
        // Enable esbuild polyfill plugins
        NodeGlobalsPolyfillPlugin({
          process: false,
          buffer: true,
        }),
      ],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    copyPublicDir: false,
    rollupOptions: {
      plugins: [inject({ Buffer: ['buffer', 'Buffer'] })],
      input: {
        main: path.resolve(__dirname, 'index.html'),
        widget: path.resolve(__dirname, 'widget.html'),
      },
    },
  },
});
