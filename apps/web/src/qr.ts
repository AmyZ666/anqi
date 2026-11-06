import jsQR from 'jsqr';
import QRCode from 'qrcode';

export function qrSvg(text: string): Promise<string> {
  // L 级纠错：连接码约 600 字符，用最低纠错让二维码尽量稀疏，手机更容易扫
  return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'L', margin: 2 });
}

export interface Scanner {
  stop(): void;
}

/**
 * 打开后置摄像头扫描二维码，扫到一次就回调并停止。
 * 需要 HTTPS（或 localhost）以及用户手势触发。
 */
export async function startScanner(
  host: HTMLElement,
  onCode: (text: string) => void,
  onError: (msg: string) => void,
): Promise<Scanner> {
  const video = document.createElement('video');
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  video.className = 'scanner';
  host.append(video);

  let stream: MediaStream | null = null;
  let stopped = false;
  const stop = () => {
    stopped = true;
    stream?.getTracks().forEach((t) => t.stop());
    video.remove();
  };

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前页面不能使用摄像头（需要 HTTPS），请改用复制粘贴');
    }
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
  } catch (e) {
    stop();
    onError(e instanceof Error && e.message.includes('HTTPS') ? e.message : '无法打开摄像头，请检查权限，或改用复制粘贴');
    return { stop() {} };
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const tick = () => {
    if (stopped) return;
    if (video.readyState >= 2 && video.videoWidth > 0) {
      // 缩到 ≤1000 宽，兼顾识别率与速度
      const scale = Math.min(1, 1000 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (r?.data) {
        stop();
        onCode(r.data);
        return;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return { stop };
}
