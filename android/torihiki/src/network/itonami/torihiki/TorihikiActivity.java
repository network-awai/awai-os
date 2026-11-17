package network.itonami.torihiki;
/** Torihiki devnet viewer host. Network reads are limited by HostActivity.torihikiRead and per-operation consent in torihiki.js. */
public final class TorihikiActivity extends network.awai.platform.HostActivity {
    @Override protected String mode(){return "torihiki";}
}
