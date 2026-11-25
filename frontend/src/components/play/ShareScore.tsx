// R9/U4 (master plan): a share image for a score, made in the browser. No
// names, no school: the score, how many ranges caught the result, and the
// site. Phones use the share sheet; elsewhere the image downloads. Wording approved at Stop 2.
export default function ShareScore({ points, hits, total, title = "Quick round" }: { points: number; hits: number; total: number; title?: string }) {
  async function share() {
    const blob = await drawCard(title, points, hits, total);
    const file = new File([blob], "stackly-score.png", { type: "image/png" });
    const text = `I scored ${points} on a Stackly ${title.toLowerCase()}: my ranges caught ${hits} of ${total}.`;
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], text });
        return;
      } catch {
        // cancelled: fall through to nothing
        return;
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "stackly-score.png";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <button type="button" className="btn btn-secondary" onClick={share}>
      Share your score
    </button>
  );
}

async function drawCard(title: string, points: number, hits: number, total: number): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = 1080;
  c.height = 1080;
  const x = c.getContext("2d")!;
  await document.fonts?.ready;
  x.fillStyle = "#0B0D12";
  x.fillRect(0, 0, 1080, 1080);
  x.fillStyle = "#B3BBC8";
  x.font = '800 54px "Barlow Condensed", sans-serif';
  x.fillText("STACKLY", 90, 150);
  x.fillStyle = "#EFEDE6";
  x.font = '800 120px "Barlow Condensed", sans-serif';
  x.fillText(title.toUpperCase(), 90, 330);
  x.fillStyle = "#F2C14E";
  x.font = '800 300px "Barlow Condensed", sans-serif';
  x.fillText(String(points), 90, 640);
  x.fillStyle = "#EFEDE6";
  x.font = '600 48px "Atkinson Hyperlegible Next", sans-serif';
  x.fillText(`points. My ranges caught ${hits} of ${total}.`, 90, 740);
  // The slab and the gold range.
  x.save();
  x.translate(540, 900);
  x.rotate((-6 * Math.PI) / 180);
  x.fillStyle = "#2A303C";
  x.beginPath();
  x.roundRect(-420, -16, 840, 32, 16);
  x.fill();
  x.fillStyle = "#F2C14E";
  x.beginPath();
  x.roundRect(-140, -30, 280, 60, 30);
  x.fill();
  x.restore();
  x.fillStyle = "#B3BBC8";
  x.font = '400 36px "Atkinson Hyperlegible Next", sans-serif';
  x.fillText("stackslymetrics.com", 90, 1010);
  return new Promise((resolve) => c.toBlob((b) => resolve(b!), "image/png"));
}
