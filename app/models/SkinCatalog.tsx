export function SkinCatalog({kind,onImport}:{kind:'pony'|'human';onImport:()=>void}){
  const pony=kind==='pony';
  return <div className="models-catalog">
    <h3>Не хочется рисовать с нуля?</h3>
    <p>Скачайте готовый PNG из каталога и загрузите сюда.</p>
    <a href={pony?'http://ponyskincraft.com/catalog.html':'https://www.minecraftskins.com/'} target="_blank" rel="noopener noreferrer">{pony?'Каталог PonySkincraft':'Каталог Skindex'} ↗</a>
    <button type="button" onClick={onImport}>Загрузить скин</button>
  </div>;
}
