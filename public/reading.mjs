// A path is identified by a branch head. Candidates are siblings, never grouped by depth alone.
export function branchPath(story,branchId) {
  const chapters=new Map(story.chapters.map(c=>[c.id,c]));
  const branch=story.branches.find(b=>b.id===Number(branchId));
  const path=[],seen=new Set();let id=branch?.head_id;
  while(id){if(seen.has(id)||!chapters.has(id))throw Error('話のつながりを確認できません。');seen.add(id);const c=chapters.get(id);path.push(c);id=c.parent_id;}
  return path.reverse();
}
export function selectReading(story,branchId,chapterId=0) {
  let branch=story.branches.find(b=>b.id===Number(branchId));
  if(!branch||(chapterId&&!branchPath(story,branch.id).some(c=>c.id===chapterId))){
    const chapter=story.chapters.find(c=>c.id===chapterId);
    branch=(chapter?story.branches.find(b=>b.id===chapter.branch_id):null)||story.branches.find(b=>b.id===story.main_branch_id)||story.branches[0];
  }
  return {branch,path:branchPath(story,branch.id)};
}
export function candidatesFor(story,chapter) {
  return story.chapters.filter(c=>c.parent_id===chapter.parent_id);
}
export function branchForCandidate(story,candidate,currentBranchId) {
  if(branchPath(story,currentBranchId).some(c=>c.id===candidate.id))return Number(currentBranchId);
  const own=story.branches.find(b=>b.id===candidate.branch_id);
  if(own&&branchPath(story,own.id).some(c=>c.id===candidate.id))return own.id;
  return story.branches.find(b=>branchPath(story,b.id).some(c=>c.id===candidate.id))?.id;
}

// Only an unshared suffix may move: every other reading path stays unchanged.
export function reorderableChapters(story, branchId) {
  const path=branchPath(story,branchId),shared=new Set();
  for(const branch of story.branches)if(branch.id!==Number(branchId)){
    for(const chapter of branchPath(story,branch.id))shared.add(chapter.id);
    if(branch.fork_chapter_id)shared.add(branch.fork_chapter_id);
  }
  let start=path.length;
  while(start>0&&path[start-1].branch_id===Number(branchId)&&!shared.has(path[start-1].id))start--;
  return path.slice(start);
}
