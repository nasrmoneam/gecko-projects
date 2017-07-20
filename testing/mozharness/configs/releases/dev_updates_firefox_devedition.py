
config = {
    "log_name": "bump_devedition",
    "repo": {
        "repo": "https://hg.mozilla.org/users/raliiev_mozilla.com/tools",
        "branch": "default",
        "dest": "tools",
        "vcs": "hg",
    },
    "vcs_share_base": "/builds/hg-shared",
    "push_dest": "ssh://hg.mozilla.org/users/raliiev_mozilla.com/tools",
    "shipped-locales-url": "https://hg.mozilla.org/projects/jamun/raw-file/{revision}/browser/locales/shipped-locales",
    "ignore_no_changes": True,
    "ssh_user": "ffxbld",
    "ssh_key": "~/.ssh/ffxbld_rsa",
    "archive_domain": "ftp.stage.mozaws.net",
    "archive_prefix": "https://ftp.stage.mozaws.net/pub",
    "previous_archive_prefix": "https://archive.mozilla.org/pub",
    "download_domain": "download.mozilla.org",
    "balrog_url": "http://ec2-54-241-39-23.us-west-1.compute.amazonaws.com:8080",
    "balrog_username": "balrog-stage-ffxbld",
    "update_channels": {
        "aurora-dev": {
            "version_regex": r"^.*$",
            "requires_mirrors": True,
            "patcher_config": "mozDevedition-branch-patcher2.cfg",
            "patcher_config_product_override": "firefox",
            "update_verify_channel": "aurora-localtest",
            "mar_channel_ids": [],
            "channel_names": ["aurora", "aurora-localtest", "aurora-cdntest"],
            "rules_to_update": ["devedition-cdntest", "devedition-localtest"],
            "publish_rules": ["devedition"],
        }
    },
    "balrog_use_dummy_suffix": False,
    "stage_product": "devedition",
    "bouncer_product": "devedition",
}
