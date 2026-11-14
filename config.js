// 보드 데이터(data.json)가 들어 있는 GitHub 저장소.
// https://<owner>.github.io/<repo>/ 로 배포하면 owner·repo는 주소에서 자동으로 잡히므로 비워 둬도 됩니다.
// path는 저장소 루트 기준 경로입니다. (예: 저장소의 docs 폴더를 배포한다면 'docs/data.json')
window.BOARD_CONFIG = {
  owner: '',
  repo: '',
  branch: 'main',
  path: 'data.json',
};
