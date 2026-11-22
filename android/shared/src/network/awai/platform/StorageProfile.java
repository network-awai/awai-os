package network.awai.platform;

/** Known RAM mount classification only; other storage is not a durability promise. */
public final class StorageProfile {
    public static String kind(String target,String mounts) {
        if(target==null||!target.startsWith("/")||mounts==null||mounts.length()>1048576)return "unknown";
        int longest=-1;String fs=null;
        for(String line:mounts.split("\n")){
            String[] fields=line.split(" +");if(fields.length<3)continue;
            String mount=fields[1].replace("\\040"," ").replace("\\011","\t").replace("\\012","\n").replace("\\134","\\");
            if(!mount.startsWith("/"))continue;
            boolean contains=target.equals(mount)||target.startsWith(mount.endsWith("/")?mount:mount+"/");
            if(contains&&mount.length()>longest){longest=mount.length();fs=fields[2];}
        }
        return fs==null?"unknown":("tmpfs".equals(fs)||"ramfs".equals(fs)?"temporary":"app-private");
    }
    private StorageProfile(){}
}
