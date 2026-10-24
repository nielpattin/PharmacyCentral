/** Whether this browser can create a WebGL context, which the vector map needs. Checked once: the answer does not change per page. */
let webglAvailable: boolean | undefined;

export const webglSupported = (): boolean => {
  webglAvailable ??= (() => {
    try {
      const canvas = document.createElement("canvas");
      return canvas.getContext("webgl2") !== null || canvas.getContext("webgl") !== null;
    } catch {
      return false;
    }
  })();
  return webglAvailable;
};

/**
 * Shown in place of a map when WebGL is switched off (hardware acceleration disabled, remote desktop, locked-down
 * browser). Everything the map only confirms stays usable: the address and the delivery fee come from the text address.
 */
export const MapUnavailable = ({ minHeight }: { minHeight: number }): React.JSX.Element => (
  <div
    role="status"
    className="grid place-items-center bg-surface-soft px-4 text-center text-sm text-muted"
    style={{ minHeight }}
  >
    Không hiển thị được bản đồ vì trình duyệt đang tắt WebGL (thử bật tăng tốc phần cứng). Bạn vẫn có thể nhập địa chỉ
    và đặt hàng bình thường.
  </div>
);
