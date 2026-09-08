import symbol from "./assets/pocket-company-symbol.png";

export default function CompanySymbol() {
  return <span className="sidebar-company-symbol"><img src={symbol} alt="포켓컴퍼니" width="388" height="318" draggable="false" /></span>;
}
