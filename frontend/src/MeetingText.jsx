import { meetingLine } from "./meetingEmphasis.js";
import "./meetingText.css";

export default function MeetingText({ children }) {
  return <span className="meeting-rich-text">{String(children ?? "").split(/\r?\n/).map((line, index) => {
    const item = meetingLine(line);
    return <span key={index} className={`meeting-text-line is-${item.tone}`}>
      {item.important && <span className="meeting-label is-important">중요</span>}
      {item.owners.map(owner => <span key={owner} className={`meeting-label is-${owner}`}>{owner === "ns" ? "NS 확인" : "포켓 확인"}</span>)}
      <span className="meeting-line-copy">{!item.important && !item.owners.length ? item.bullet : ""}{item.text || "\u00a0"}</span>
    </span>;
  })}</span>;
}
