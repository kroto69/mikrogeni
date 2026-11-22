import { useTheme } from "@/hooks/useTheme";
import { isNbStyle } from "@/lib/nb";

/** Ornamen 2D datar (aturan 6): lingkaran/segitiga/plus/ring, fill solid
    + outline tinta — BUKAN isometrik/3D. Posisi meniru mockup:
    desktop mengintip dari tepi + klaster di area kosong bawah,
    mobile mengintip dari tepi kiri/kanan. Hanya tampil di mode nb. */
function FlatCircle({ size, fill }: { size: number; fill: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="46" fill={fill} stroke="currentColor" strokeWidth="5" />
    </svg>
  );
}

function FlatTri({ size, fill }: { size: number; fill: string }) {
  return (
    <svg width={size} height={size * 0.9} viewBox="0 0 100 90">
      <polygon points="50,4 96,86 4,86" fill={fill} stroke="currentColor" strokeWidth="5" strokeLinejoin="round" />
    </svg>
  );
}

function FlatPlus({ size, fill }: { size: number; fill: string }) {
  const pts = "35,5 65,5 65,35 95,35 95,65 65,65 65,95 35,95 35,65 5,65 5,35 35,35";
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <polygon points={pts} fill={fill} stroke="currentColor" strokeWidth="5" strokeLinejoin="round" />
    </svg>
  );
}

function FlatRing({ size, stroke }: { size: number; stroke: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="40" fill="none" stroke={stroke} strokeWidth="12" />
    </svg>
  );
}

function FlatCluster() {
  return (
    <svg width="300" height="225" viewBox="0 0 320 240">
      <circle cx="105" cy="140" r="58" fill="#EA435F" stroke="currentColor" strokeWidth="3" />
      <polygon points="215,45 285,165 150,165" fill="#54CFC0" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <polygon points="94,18 116,18 116,39 137,39 137,61 116,61 116,82 94,82 94,61 73,61 73,39 94,39" fill="#FFD95C" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="255" cy="200" r="18" fill="none" stroke="#EA435F" strokeWidth="7" />
      <circle cx="60" cy="210" r="16" fill="#FFD95C" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}

export function NbDecor() {
  const { styleMode } = useTheme();
  if (!isNbStyle(styleMode)) return null;
  return (
    <>
      <div aria-hidden className="nb-decor hidden text-foreground md:block">
        <span style={{ left: "10%", top: "70%" }}>
          <FlatCluster />
        </span>
        <span style={{ left: "82%", top: "72%" }}>
          <FlatTri size={64} fill="#54CFC0" />
        </span>
        <span style={{ left: "58%", top: "82%" }}>
          <FlatCircle size={44} fill="#FFD95C" />
        </span>
        <span style={{ left: "32%", top: "84%" }}>
          <FlatPlus size={48} fill="#EA435F" />
        </span>
        <span style={{ left: "68%", top: "76%" }}>
          <FlatRing size={28} stroke="#EA435F" />
        </span>
      </div>
      <div aria-hidden className="nb-decor text-foreground md:hidden">
        <span style={{ left: "86%", top: "5%" }}>
          <FlatCircle size={40} fill="#EA435F" />
        </span>
        <span style={{ left: "0%", top: "25%" }}>
          <FlatTri size={30} fill="#54CFC0" />
        </span>
        <span style={{ left: "96.5%", top: "50%" }}>
          <FlatPlus size={36} fill="#FFD95C" />
        </span>
        <span style={{ left: "0%", top: "78%" }}>
          <FlatRing size={30} stroke="#EA435F" />
        </span>
        <span style={{ left: "96.5%", top: "88%" }}>
          <FlatCircle size={34} fill="#54CFC0" />
        </span>
      </div>
    </>
  );
}
