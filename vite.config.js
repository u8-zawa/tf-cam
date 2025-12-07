import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import tailwindcss from '@tailwindcss/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
    build: {
        target: 'esnext',
        sourcemap: false,
        minify: 'terser',
        terserOptions: {
            compress: {
                drop_console: true,
                drop_debugger: true,

                pure_getters: true,
                passes: 3,
                booleans: true,
                conditionals: true,
                dead_code: true,
                unsafe_arrows: true,
            },
            mangle: {
                toplevel: true,
            },
            format: {
                comments: false,
            },
        },
    },
    plugins: [
        basicSsl(),
        tailwindcss(),
        viteStaticCopy({
            targets: [
                {
                    src: 'node_modules/@tensorflow/tfjs-tflite/dist/tflite_web_api*',
                    dest: './'
                }
            ]
        }),
    ],
    server: {
        https: true, // プラグインで自己署名証明書を供給
        host: true,  // LAN 公開（実機アクセス用）
        port: 5173,
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
    },
    preview: {
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
    },
    assetsInclude: ['**/*.wasm'],
});