"""Local Git fixture regression; creates no network or Port Daddy processes."""
from pathlib import Path
from types import SimpleNamespace
import importlib.util, os, shutil, subprocess, tempfile, unittest, sys
P=Path(__file__).resolve().parent
# These settings confine fixture commits to test-only identity and prevent
# ambient signing, hooks, credentials or repo settings affecting a unit test.
os.environ.update(GIT_CONFIG_NOSYSTEM="1",GIT_CONFIG_GLOBAL="/dev/null",GIT_CONFIG_COUNT="2",GIT_CONFIG_KEY_0="core.hooksPath",GIT_CONFIG_VALUE_0="/dev/null",GIT_CONFIG_KEY_1="commit.gpgsign",GIT_CONFIG_VALUE_1="false")
sys.path.insert(0,str(P))
from harness.substrates import GitWorkspace, _run
from unittest.mock import patch
for key in ["GIT_AUTHOR_NAME","GIT_AUTHOR_EMAIL","GIT_AUTHOR_DATE","GIT_COMMITTER_NAME","GIT_COMMITTER_EMAIL","GIT_COMMITTER_DATE"]: os.environ.pop(key,None)

def git(cwd,*args):
 return subprocess.run(["git",*args],cwd=cwd,check=True,capture_output=True,text=True).stdout.strip()

class SingleTaskRebase(unittest.TestCase):
 def setUp(self):
  root=P/"test-runs";root.mkdir(exist_ok=True);self.tmp=Path(tempfile.mkdtemp(prefix="fixture-",dir=root));self.repo=self.tmp/"corpus";self.repo.mkdir()
  git(self.repo,"init","-q","-b","codex/fixture");git(self.repo,"config","user.name","fixture");git(self.repo,"config","user.email","fixture@example.invalid");(self.repo/"base.txt").write_text("base\n");git(self.repo,"add","base.txt");git(self.repo,"commit","-qm","base");self.base=git(self.repo,"rev-parse","HEAD");self.tasks=[];self.workspaces=[]
 def tearDown(self):
  for ws in self.workspaces:ws.cleanup()
  shutil.rmtree(self.tmp)
 def task(self,path,text):
  parent=git(self.repo,"rev-parse","HEAD");(self.repo/path).write_text(text);git(self.repo,"add",path);git(self.repo,"commit","-qm",f"history-{len(self.tasks)}");sha=git(self.repo,"rev-parse","HEAD")
  patch=subprocess.run(["git","diff","--binary",parent,sha],cwd=self.repo,check=True,capture_output=True,text=True).stdout
  t=SimpleNamespace(task_id=len(self.tasks),parent_sha=parent,sha=sha,patch=patch,files=[path]);self.tasks.append(t);return t
 def workspace(self):
  bare=self.tmp/"corpus.git";git(self.tmp,"clone","--bare","--quiet",str(self.repo),str(bare));ws=GitWorkspace(str(self.tmp/"run"),str(bare),self.base,2,True);ws.setup();self.workspaces.append(ws);return ws
 def test_inherited_author_identity_is_overridden(self):
  with patch.dict(os.environ,{"GIT_AUTHOR_NAME":"ambient-author","GIT_AUTHOR_EMAIL":"ambient@example.invalid"}):
   self.assertEqual(_run(self.repo,["var","GIT_AUTHOR_IDENT"]).stdout.strip(),"s2-sim <s2-sim@substrate-study.invalid> 1767225600 +0000")
 def test_out_of_order_independent_task_does_not_import_ancestor(self):
  first=self.task("first.txt","first\n");second=self.task("second.txt","second\n");ws=self.workspace()
  self.assertTrue(ws.d_try_land(0,second));self.assertTrue((Path(ws.main_dir)/"second.txt").exists());self.assertFalse((Path(ws.main_dir)/"first.txt").exists(),"A single-task landing imported unlanded historical work")
  self.assertEqual(git(ws.main_dir,"rev-list","--count",self.base+"..HEAD"),"1")
  self.assertTrue(ws.d_try_land(1,first));self.assertTrue((Path(ws.main_dir)/"first.txt").exists());self.assertTrue((Path(ws.main_dir)/"second.txt").exists())
 def test_missing_prerequisite_fails_then_retry_after_queue_advance(self):
  first=self.task("base.txt","first\n");second=self.task("base.txt","second\n");ws=self.workspace();before=ws.queue_head_sha
  self.assertFalse(ws.d_try_land(0,second));self.assertEqual(ws.queue_head_sha,before);self.assertEqual((Path(ws.main_dir)/"base.txt").read_text(),"base\n")
  self.assertTrue(ws.d_try_land(1,first));self.assertTrue(ws.d_try_land(0,second));self.assertEqual((Path(ws.main_dir)/"base.txt").read_text(),"second\n")
 def test_conflict_preserves_queue_and_cached_local_commit(self):
  first=self.task("base.txt","first\n");git(self.repo,"checkout","--detach",self.base);conflict=self.task("base.txt","other\n");ws=self.workspace();self.assertTrue(ws.d_try_land(0,first));before=ws.queue_head_sha
  self.assertFalse(ws.d_try_land(1,conflict));self.assertEqual(ws.queue_head_sha,before);self.assertEqual((Path(ws.main_dir)/"base.txt").read_text(),"first\n");self.assertEqual(git(ws.agent_dirs[1],"rev-parse","HEAD"),ws._d_local_commit[1][1])
if __name__=="__main__":unittest.main(verbosity=2)
