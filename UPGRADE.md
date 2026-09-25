# After upgrading DSH

The patches modify files under `node_modules`, so a new DSH version does not carry them.
With the layout `install.sh` uses, nothing is actually deleted. The new version gets its
own directory, and once `current` points at it, the running code is unpatched:

```
$DSH_RUNTIME_DIR/
  0.1.6-alpha.1/            pristine (never modified)
  0.1.6-alpha.1-patched/    copy made by install.sh
  0.1.7/                    new version, unpatched
  current -> 0.1.7
```

The plan: notice when this happens, then re-apply quickly.

The examples assume `DSH_RUNTIME_DIR` is set (the `install.sh` default is `~/.local/dsh-runtime`)
and are run from the repository root.

## 1. Re-apply (three commands)

```bash
./install.sh --check 0.1.7                         # dry run: do all patches apply?
./install.sh --version 0.1.7                       # copy to 0.1.7-patched, patch, switch
test/suite.sh "$DSH_RUNTIME_DIR/0.1.7-patched"     # must print SUITE PASS
```

If `--check` reports a FAIL, do not run `--version`. `install.sh` refuses to switch when a
single patch does not apply, so a half-patched state cannot happen.

## 2. When a patch no longer applies

A patch that no longer applies means the surrounding code has changed. There are two
possibilities.

### (a) Fixed upstream: drop the patch

First check whether the defect is still there, using the pristine new version:

```bash
node test/stress.mjs "$DSH_RUNTIME_DIR/0.1.7" 100 60000 0     # D4
./test/safari-jsc-check.sh "$DSH_RUNTIME_DIR/0.1.7"          # D1 (needs JavaScriptCore)
```

If the pristine version passes (HANG=0, `chunk record (usage): OK`), the corresponding
patch is no longer needed. Otherwise go to (b). If D4 is still present, every hanging run
waits out the 60 s budget and the stress run takes a long time. `100 1200` gives a quicker
first answer, but a fix that recovers slowly would then also be counted as HANG.

### (b) Not fixed: re-create the patch

The README explains what each defect is. Find the same place in the new code and make
the same change. Starting points:

```bash
RT="$DSH_RUNTIME_DIR/0.1.7/node_modules/@deepseek-ai"
grep -n '\[native code\]' "$RT/dsh-api-session-controller/lib/client.js" "$RT/dsh-util-values/lib/index.js"
                                         # D1: still unfixed if the result is compared exactly with the V8 string
grep -n "MAX_MISSED_HEARTBEATS" "$RT/dsh-api-gateway/lib/index.js"                   # D3
grep -n 'openState = "loading"' "$RT/dsh-api-session-controller/lib/client.js"       # D2, D5
grep -n "current === this.watched" "$RT/dsh-api-session-controller/lib/client.js"    # D6
node tools/scan-busy-flags.mjs    "$DSH_RUNTIME_DIR/0.1.7"    # D5/D12/D14 kind
node tools/scan-hot-listeners.mjs "$DSH_RUNTIME_DIR/0.1.7"    # D7/D8 kind
```

The scanners are included for this reason: they record how to find this kind of defect,
not just where it was found last time.

## 3. The heartbeat setting survives upgrades

`websocketHeartbeatIntervalMs: 30000` lives in `$DSH_HOME/profiles/web/cordis.patch.yml`,
outside the runtime directory. Even when the patches are gone, the setting still reduces
disconnects. `install.sh` does not add it twice.

Your other DSH configuration (profiles, plugins installed into a profile, sessions,
settings) also lives under `$DSH_HOME`, not in the runtime directory. Switching `current`
does not affect it. `install.sh` copies the whole version directory with `cp -a`, so all
dependencies come along. In a measured copy, 13 of 23,047 files differed from the
pristine version: exactly the patched ones.

The only user file `install.sh` edits is `cordis.patch.yml`, when it appends the
heartbeat setting. It saves a backup first. Check the result once:

```bash
tail -12 "$DSH_HOME/profiles/web/cordis.patch.yml"     # typert-gateway at the end?
ls "$DSH_HOME/profiles/web/cordis.patch.yml.bak-"*     # the backups
```

## 4. Notice when the patches are gone

`patch-status.sh` prints `DSH patch: ACTIVE (...)`, or lists what is missing and exits 1.

At login (for example from `~/.bashrc`):

```bash
/path/to/dsh-loading-hang-fix/patch-status.sh
```

Daily, with a systemd user timer. Add an `OnFailure=` line that points at your own
notification unit if you want an alert.

```ini
# ~/.config/systemd/user/dsh-patch-check.service
[Unit]
Description=Check that the DSH loading-hang patches are active

[Service]
Type=oneshot
ExecStart=/path/to/dsh-loading-hang-fix/patch-status.sh
```

```ini
# ~/.config/systemd/user/dsh-patch-check.timer
[Unit]
Description=Daily DSH patch check

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now dsh-patch-check.timer
```

## 5. Options, from least to most maintenance

1. **Upstream fixes.** If DSH itself fixes these defects, none of this is needed. The
   reproductions in `test/` (for example `stress.mjs` with `loadreal.mjs`, and
   `safari-jsc-check.sh`) only need an installed runtime, not a running DSH.
2. **The setting only.** Skip the patches and keep only the heartbeat setting. It helps
   less and does nothing for Safari (D1), but it survives upgrades and needs no
   maintenance.
3. **Keep patching.** This gives the most complete fix, but every upgrade needs steps 1
   and 2 above.
