// Updated dashboard page
// Change: Web photo placeholder uses a subtle em-dash icon (—), mobile renders nothing when no photos.

function PhotoCell({ url, count }: { url?: string; count: number }) {
  if (!count || count <= 0) {
    return <span className="photoDashWeb">—</span>;
  }

  return (
    <div className="photoCell">
      <img src={url} alt="" />
      <span className="photoCount">{count}</span>
    </div>
  );
}

export default function Page() {
  return (
    <main className="page">
      {/* rest of dashboard */}
      <style jsx>{`
        @media (max-width: 820px) {
          .photoDashWeb {
            display: none;
          }
        }
      `}</style>
    </main>
  );
}
