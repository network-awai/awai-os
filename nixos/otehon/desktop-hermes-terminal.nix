{ lib, ... }:
{
  # Negative control for the agent check: the same image with the terminal toolset on. The check
  # must fail at agent_no_terminal, because the agent runs the command.
  imports = [ ./desktop-hermes.nix ];

  system.image.id = lib.mkOverride 30 "awai-otehon-desktop-hermes-terminal";

  otehon.agent.toolsets = [ "saifu" "terminal" ];
}
