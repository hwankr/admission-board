// 보드 데이터가 저장되는 Supabase 프로젝트.
// supabaseKey는 브라우저에 공개하도록 만들어진 키(publishable)다. 누가 무엇을 할 수 있는지는
// 키가 아니라 표의 권한 규칙이 정한다: board_versions 표는 누구나 읽기·추가만 가능, 수정·삭제 불가.
window.BOARD_CONFIG = {
  supabaseUrl: 'https://mcvycwlnalhwuivubzni.supabase.co',
  supabaseKey: 'sb_publishable_sFAO1fNuElQLjSFwDmDEEA_zWi1rndM',
};
