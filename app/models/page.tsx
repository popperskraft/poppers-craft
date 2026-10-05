import { ModelStudio } from './ModelStudio';
export const metadata = { title: 'Модели персонажей — PoppersCraft' };
export default async function ModelsPage({searchParams}:{searchParams:Promise<{editor?:string;skin?:string;add?:string}>}){
  const {editor,skin,add}=await searchParams;return <ModelStudio initialEditor={editor==='human'?'human':'pony'} initialSlot={skin} initialAdd={add==='1'}/>;
}
