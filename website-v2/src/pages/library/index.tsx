import { WHITE_PAPERS } from '../data/whitePapers'

export default function Library() {
  return (
    <div>
      {WHITE_PAPERS.map(paper => (
        <div key={paper.id}>
          <h2>{paper.title}</h2>
          <p>Maturity: {paper.maturity}</p>
        </div>
      ))}
    </div>
  )
}