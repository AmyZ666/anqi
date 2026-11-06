import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // 相对路径：GitHub Pages 项目站点（/仓库名/）与内网服务器根路径通用
  base: './',
  server: {
    host: true,
    proxy: { '/ws': { target: 'ws://localhost:8080', ws: true } },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '暗棋',
        short_name: '暗棋',
        description: '中国象棋暗棋变体，同一 Wi-Fi / 热点下面对面点对点对战',
        lang: 'zh-CN',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        background_color: '#f4efe4',
        theme_color: '#2f7d32',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 预缓存全部构建产物，离线（飞行模式 / 无外网的热点）也能从主屏幕启动
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
