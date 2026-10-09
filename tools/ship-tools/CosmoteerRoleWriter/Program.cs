using System.Collections;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

var write = args.Contains("--write", StringComparer.OrdinalIgnoreCase);
var configIndex = Array.FindIndex(args, arg => arg.Equals("--config", StringComparison.OrdinalIgnoreCase));
if (configIndex < 0 || configIndex + 1 >= args.Length) {
    Console.Error.WriteLine("Usage: CosmoteerRoleWriter --config <local-config.json> [--write]");
    return 2;
}
var configPath = Path.GetFullPath(args[configIndex + 1]);
var config = JsonSerializer.Deserialize<WriterConfig>(File.ReadAllText(configPath), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
    ?? throw new InvalidDataException("Could not read writer configuration.");
var configDirectory = Path.GetDirectoryName(configPath)!;
string ResolveConfigPath(string value) {
    var expanded = System.Text.RegularExpressions.Regex.Replace(value, @"\$\{([A-Za-z_][A-Za-z0-9_]*)\}", match => {
        var name = match.Groups[1].Value;
        return Environment.GetEnvironmentVariable(name)
            ?? throw new InvalidDataException($"Config path token ${{{name}}} has no matching environment variable.");
    });
    return Path.GetFullPath(Path.IsPathRooted(expanded) ? expanded : Path.Combine(configDirectory, expanded));
}
var gameBin = ResolveConfigPath(config.GameBin);
var library = ResolveConfigPath(config.ShipLibraryRoot);
var targets = config.Targets.Select(ResolveConfigPath).ToArray();
var jsonPath = ResolveConfigPath(config.DirectionalDataFile);
var outputRoot = ResolveConfigPath(config.OutputDirectory);
var backupDirectory = ResolveConfigPath(config.BackupDirectory);
if (!Directory.Exists(gameBin)) throw new DirectoryNotFoundException("Cosmoteer Bin folder not found: " + gameBin);
if (targets.Length != 2 || targets.Distinct(StringComparer.OrdinalIgnoreCase).Count() != 2)
    throw new InvalidDataException("The guarded role writer expects exactly two distinct target ship files.");
foreach (var target in targets) {
    var relative = Path.GetRelativePath(library, target);
    if (relative == ".." || relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal) || Path.IsPathRooted(relative))
        throw new InvalidDataException("Every target must be inside ShipLibraryRoot: " + target);
}
Directory.CreateDirectory(outputRoot);

using var doc = JsonDocument.Parse(File.ReadAllText(jsonPath));
var defs = new List<PDef>();
var seenDefs = new HashSet<PKey>();
foreach (var e in doc.RootElement.GetProperty("priority_map").EnumerateArray()) {
    if (e.GetProperty("ui_visibility").GetString() != "VISIBLE UI ACTION") continue;
    var key = new PKey(e.GetProperty("part_id").GetString()!, e.GetProperty("component_id").GetString()!);
    if (!seenDefs.Add(key)) continue;
    if (e.GetProperty("builtin_default").ValueKind != JsonValueKind.Number) throw new Exception($"Unresolved default: {key}");
    defs.Add(new PDef(key, e.GetProperty("ui_category").GetString()!, e.GetProperty("ui_action").GetString()!, e.GetProperty("part_name").GetString()!, e.GetProperty("builtin_default").GetInt32()));
}
if (defs.Count != 131) throw new Exception($"Expected 131 current visible exact keys, got {defs.Count}");
var defByKey = defs.ToDictionary(x => x.Key);
var defByPartAction = defs.GroupBy(x => (x.Key.Part, x.Action)).ToDictionary(g => g.Key, g => g.Single());

var game = Assembly.LoadFrom(Path.Combine(gameBin, "Cosmoteer.dll"));
var core = Assembly.LoadFrom(Path.Combine(gameBin, "HalflingCore.dll"));
var shipType = game.GetType("Cosmoteer.Ships.Ship", true)!;
var textureType = core.GetType("Halfling.Graphics.TextureData", true)!;
var textureStreamType = core.GetType("Halfling.IO.TextureDataStream", true)!;
var imageFormatType = core.GetType("Halfling.Graphics.ImageFileFormat", true)!;
var nodeType = core.GetType("Halfling.ObjectBits.OBNode", true)!;
var loadTexture = textureType.GetMethod("LoadFrom", new[] { typeof(string) })!;
var loadNode = shipType.GetMethod("LoadOBNode", new[] { textureType })!;
var loadStream = shipType.GetMethod("LoadStream", new[] { typeof(string) })!;
var writeNode = nodeType.GetMethod("WriteTo", new[] { typeof(Stream) })!;
var cloneNode = nodeType.GetConstructor(new[] { nodeType })!;
var stringIndexer = nodeType.GetProperty("Item", new[] { typeof(string) })!;
var dataProp = nodeType.GetProperty("Data")!;
var finalProp = nodeType.GetProperty("FinalLinkTarget")!;
var changeList = nodeType.GetMethod("ChangeToChildList")!;
var getEntries = nodeType.GetMethod("EnumerateChildrenByName")!;
var subtree = nodeType.GetMethod("GetSubtreeString", Type.EmptyTypes)!;
var saveTexture = textureType.GetMethod("SaveTo", new[] { typeof(string), imageFormatType, typeof(int) })!;
var pngFormat = Enum.GetValues(imageFormatType).Cast<object>().First(x => x.ToString()!.Contains("PNG", StringComparison.OrdinalIgnoreCase));
object ReadRoot(string path) { using var encoded=(Stream)loadStream.Invoke(null,new object[]{path})!; encoded.Position=9; using var gzip=new GZipStream(encoded,CompressionMode.Decompress); return Activator.CreateInstance(nodeType,new object[]{gzip,false})!; }

object Final(object node) => finalProp.GetValue(node)!;
object Child(object node, string name) => Final(stringIndexer.GetValue(Final(node), new object[] { name }) ?? throw new Exception($"Missing child {name}"));
byte[] Data(object node) => (byte[])dataProp.GetValue(Final(node))!;
void SetData(object node, byte[] value) => dataProp.SetValue(Final(node), value);
string ReadString(object node) { using var br = new BinaryReader(new MemoryStream(Data(node)), Encoding.UTF8); return br.ReadString(); }
byte[] StringData(string value) { using var ms = new MemoryStream(); using (var bw = new BinaryWriter(ms, Encoding.UTF8, true)) bw.Write(value); return ms.ToArray(); }
int ReadInt(object node) => BitConverter.ToInt32(Data(node));
object Clone(object node) { using var ms=new MemoryStream(); writeNode.Invoke(Final(node),new object[]{ms}); ms.Position=0; return Activator.CreateInstance(nodeType,new object[]{ms,false})!; }
List<object> Children(object node) => ((IEnumerable)Final(node)).Cast<object>().Select(Final).ToList();
void ReplaceList(object node, IReadOnlyList<object> children) { var arr = Array.CreateInstance(nodeType, children.Count); for (var i=0;i<children.Count;i++) arr.SetValue(children[i],i); changeList.Invoke(Final(node),new object[]{arr}); }
PKey EntryKey(object entry) { var key=Child(entry,"Key"); return new PKey(ReadString(Child(key,"PartID")),ReadString(Child(key,"ComponentID"))); }
int EntryValue(object entry) => ReadInt(Child(entry,"Value"));
void SetEntry(object entry, PKey key, int value) { var k=Child(entry,"Key"); SetData(Child(k,"PartID"),StringData(key.Part)); SetData(Child(k,"ComponentID"),StringData(key.Component)); SetData(Child(entry,"Value"),BitConverter.GetBytes(value)); }
string HashFile(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();
string NonRoleSignature(object node) { var parts=new List<string>(); foreach(var item in (IEnumerable)getEntries.Invoke(Final(node),null)!) { var t=item!.GetType(); var key=(string)t.GetProperty("Key")!.GetValue(item)!; if(key=="Roles") continue; var value=Final(t.GetProperty("Value")!.GetValue(item)!); parts.Add(key+"="+(string)subtree.Invoke(value,null)!); } return string.Join("\n",parts); }

var expectedRoles = new[]{"Unasigned","Special asigment","Engine(r)","Operator","Defender","Defender - PD focus","Astrophobic Cargo Crew","Loader","Distributor"};
var staged = new List<(string Target,string Temp,string BeforeHash,string AfterHash,Dictionary<string,int> Counts)>();
var runStamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
var backupRoot = Path.Combine(backupDirectory, runStamp);
var reportChanges = new SortedDictionary<string,List<string>>(StringComparer.Ordinal);

foreach (var target in targets) {
    if (!File.Exists(target)) throw new FileNotFoundException(target);
    var texture = loadTexture.Invoke(null,new object[]{target})!;
    try {
        var root = ReadRoot(target);
        var nonRoleBefore = NonRoleSignature(root);
        var rolesNode = Child(root,"Roles");
        var roleNodes = Children(rolesNode);
        var byName = roleNodes.ToDictionary(r => ReadString(Child(r,"Name")), StringComparer.Ordinal);
        if (!expectedRoles.SequenceEqual(roleNodes.Select(r=>ReadString(Child(r,"Name"))))) throw new Exception("Unexpected role list/order in "+target);
        var idsBefore = roleNodes.ToDictionary(r=>ReadString(Child(r,"Name")),r=>ReadInt(Child(r,"ID")));
        var existing = new Dictionary<string,Dictionary<PKey,int>>(StringComparer.Ordinal);
        var sourceEntry = new Dictionary<PKey,object>();
        var internalEntries = new Dictionary<string,List<object>>(StringComparer.Ordinal);
        object? prototype = null;
        foreach (var role in roleNodes) {
            var name=ReadString(Child(role,"Name")); var map=new Dictionary<PKey,int>(); var internals=new List<object>();
            foreach(var entry in Children(Child(role,"Priorities"))) { prototype ??= entry; var k=EntryKey(entry); map[k]=EntryValue(entry); sourceEntry.TryAdd(k,entry); if(!defByKey.ContainsKey(k)) internals.Add(Clone(entry)); }
            existing[name]=map; internalEntries[name]=internals;
        }
        if (prototype is null) throw new Exception("No priority prototype");
        var values = new Dictionary<string,Dictionary<PKey,int>>(StringComparer.Ordinal);
        foreach(var name in expectedRoles) values[name]=defs.ToDictionary(d=>d.Key,d=>existing[name].TryGetValue(d.Key,out var v)?v:d.Default);
        void Set(string role,string part,string action,int value,string why) { var d=defByPartAction[(part,action)]; var old=values[role][d.Key]; values[role][d.Key]=value; if(old!=value){ if(!reportChanges.TryGetValue(role,out var list)) reportChanges[role]=list=new(); list.Add($"{d.PartName} / {action}: {old} -> {value} ({why})"); } }
        foreach(var d in defs) values["Special asigment"][d.Key]=10;
        // Confirmed E3 donor carry-forward into E4.
        Set("Engine(r)","cosmoteer.engine_room","Operate",9,"confirmed E3 donor");
        Set("Engine(r)","cosmoteer.thruster_rocket_extender","Supply Battery",9,"confirmed E3 donor");
        Set("Engine(r)","cosmoteer.thruster_rocket_battery","Supply Battery",9,"confirmed E3 donor");
        Set("Engine(r)","cosmoteer.hyperdrive_beacon","Operate",0,"confirmed E3 donor");
        Set("Engine(r)","cosmoteer.sensor_array","Operate",0,"confirmed E3 donor");
        Set("Engine(r)","cosmoteer.tractor_beam_emitter","Operate",0,"confirmed E3 donor");
        Set("Engine(r)","cosmoteer.manipulator_beam_emitter","Supply Battery",6,"confirmed E3 donor");
        Set("Engine(r)","cosmoteer.hyperdrive_beacon","Supply Battery",3,"confirmed E3 donor");
        Set("Engine(r)","cosmoteer.sensor_array","Supply Battery",6,"confirmed E3 donor");
        Set("Engine(r)","cosmoteer.tractor_beam_emitter","Supply Battery",5,"confirmed E3 donor");
        Set("Loader","cosmoteer.thruster_rocket_nozzle","Operate",0,"confirmed loader coverage");
        // Distributor family completions.
        Set("Distributor","cosmoteer.resonance_beam_turret","Operate",0,"weapon-family completion");
        Set("Distributor","cosmoteer.resonance_beam_turret","Supply Battery",4,"weapon-family completion");
        Set("Distributor","cosmoteer.thermal_amplification_pump","Supply Battery",4,"weapon-family completion");
        Set("Distributor","cosmoteer.thermal_dilation_pump","Supply Battery",4,"weapon-family completion");
        Set("Distributor","cosmoteer.chaingun","Operate",0,"weapon-family completion");
        Set("Distributor","cosmoteer.missile_launcher","Supply T.C. Missile",8,"missile-family completion");
        Set("Distributor","cosmoteer.factory_thermal","Supply Battery",4,"production-family completion");
        Set("Distributor","cosmoteer.factory_thermal","Supply Copper",3,"production-family completion");
        Set("Distributor","cosmoteer.factory_thermal","Supply Sulfur",3,"production-family completion");
        Set("Distributor","cosmoteer.thruster_rocket_nozzle","Operate",0,"engine-operation suppression");
        // Defender current-part completions.
        foreach(var role in new[]{"Defender","Defender - PD focus"}) {
            Set(role,"cosmoteer.resonance_beam_turret","Operate",0,"defender weapon-family completion");
            Set(role,"cosmoteer.resonance_beam_turret","Supply Battery",4,"defender weapon-family completion");
            Set(role,"cosmoteer.thermal_amplification_pump","Supply Battery",4,"defender weapon-family completion");
            Set(role,"cosmoteer.thermal_dilation_pump","Supply Battery",4,"defender weapon-family completion");
            Set(role,"cosmoteer.chaingun","Operate",0,"defender weapon-family completion");
            Set(role,"cosmoteer.chaingun","Supply Ammo",4,"defender weapon-family completion");
            Set(role,"cosmoteer.chaingun_magazine","Supply Ammo",4,"defender weapon-family completion");
            Set(role,"cosmoteer.missile_launcher","Supply T.C. Missile",4,"defender missile-family completion");
            Set(role,"cosmoteer.hyperdrive_beacon","Operate",0,"utility-operation suppression");
            Set(role,"cosmoteer.thruster_rocket_nozzle","Operate",8,"engine-room -1 family offset");
        }
        // PD focus inherits Defender everywhere, then retains its five intentional focus differences.
        var pdFocusKeys = new HashSet<PKey> {
            defByPartAction[("cosmoteer.flak_cannon_large","Operate")].Key,
            defByPartAction[("cosmoteer.flak_cannon_large","Supply Ammo")].Key,
            defByPartAction[("cosmoteer.shield_gen_small","Supply Battery")].Key,
            defByPartAction[("cosmoteer.shield_gen_large","Supply Battery")].Key,
            defByPartAction[("cosmoteer.point_defense","Supply Battery")].Key
        };
        foreach(var d in defs) if(!pdFocusKeys.Contains(d.Key) && values["Defender - PD focus"][d.Key] != values["Defender"][d.Key]) {
            var oldPd=values["Defender - PD focus"][d.Key]; var newPd=values["Defender"][d.Key]; values["Defender - PD focus"][d.Key]=newPd;
            if(!reportChanges.TryGetValue("Defender - PD focus",out var pdList)) reportChanges["Defender - PD focus"]=pdList=new();
            pdList.Add($"{d.PartName} / {d.Action}: {oldPd} -> {newPd} (inherit Defender outside five PD-focus distinctions)");
        }
        Set("Defender - PD focus","cosmoteer.flak_cannon_large","Operate",6,"PD focus distinction");
        Set("Defender - PD focus","cosmoteer.flak_cannon_large","Supply Ammo",5,"PD focus distinction");
        Set("Defender - PD focus","cosmoteer.shield_gen_small","Supply Battery",7,"PD focus distinction");
        Set("Defender - PD focus","cosmoteer.shield_gen_large","Supply Battery",8,"PD focus distinction");
        Set("Defender - PD focus","cosmoteer.point_defense","Supply Battery",9,"PD focus distinction");
        // Make all visible values explicit; preserve pre-existing non-UI/internal keys verbatim.
        foreach(var role in roleNodes) {
            var name=ReadString(Child(role,"Name")); var outEntries=new List<object>();
            foreach(var d in defs) { object entry; if(sourceEntry.TryGetValue(d.Key,out var src)) entry=Clone(src); else { entry=Clone(prototype); SetEntry(entry,d.Key,values[name][d.Key]); } SetEntry(entry,d.Key,values[name][d.Key]); outEntries.Add(entry); }
            outEntries.AddRange(internalEntries[name].Select(Clone));
            ReplaceList(Child(role,"Priorities"),outEntries);
        }
        if(!idsBefore.All(kv=>ReadInt(Child(byName[kv.Key],"ID"))==kv.Value)) throw new Exception("Role IDs changed in memory");
        // Verify no non-role ship data changed.
        if(nonRoleBefore != NonRoleSignature(root)) throw new Exception("Non-role ship data changed");
        byte[] header=new byte[9]; using(var source=(Stream)loadStream.Invoke(null,new object[]{target})!) { if(source.Read(header,0,9)!=9) throw new Exception("Short ship header"); }
        using var encoded=new MemoryStream(); encoded.Write(header); using(var gz=new GZipStream(encoded,CompressionLevel.Optimal,true)) writeNode.Invoke(root,new object[]{gz});
        var payload=encoded.ToArray(); using(var pixelStream=(Stream)Activator.CreateInstance(textureStreamType,new object[]{texture,true,1,1,1,0})!) pixelStream.Write(payload,0,payload.Length);
        var temp=Path.Combine(outputRoot,Path.GetFileName(Path.GetDirectoryName(target))+"--"+Path.GetFileName(target));
        saveTexture.Invoke(texture,new object[]{temp,pngFormat,0});
        // Decode validation of staged file.
        var checkRoot=ReadRoot(temp); { var checkRoles=Children(Child(checkRoot,"Roles")); var checkNames=checkRoles.Select(r=>ReadString(Child(r,"Name"))).ToArray(); if(!expectedRoles.SequenceEqual(checkNames)) throw new Exception("Staged role names differ: "+string.Join(" | ",checkNames)); var counts=new Dictionary<string,int>(); foreach(var rr in checkRoles){var n=ReadString(Child(rr,"Name")); var es=Children(Child(rr,"Priorities")); counts[n]=es.Count; var m=es.ToDictionary(EntryKey,EntryValue); foreach(var d in defs) if(!m.TryGetValue(d.Key,out var got)||got!=values[n][d.Key]) throw new Exception($"Validation mismatch {n} {d.PartName}/{d.Action}"); if(ReadInt(Child(rr,"ID"))!=idsBefore[n]) throw new Exception("Staged role ID changed"); } staged.Add((target,temp,HashFile(target),HashFile(temp),counts)); }
    } finally { if(texture is IDisposable d) d.Dispose(); }
}

if (write) {
    Directory.CreateDirectory(backupRoot);
    foreach(var s in staged){var rel=Path.GetRelativePath(library,s.Target); var backup=Path.Combine(backupRoot,rel); Directory.CreateDirectory(Path.GetDirectoryName(backup)!); File.Copy(s.Target,backup,false);}
    var committed=new List<(string Target,string Backup)>();
    try {
        foreach(var s in staged){var rel=Path.GetRelativePath(library,s.Target); var backup=Path.Combine(backupRoot,rel); var sibling=s.Target+".codex-role-write.tmp"; File.Copy(s.Temp,sibling,true); File.Replace(sibling,s.Target,null); committed.Add((s.Target,backup));}
    } catch { foreach(var c in committed) File.Copy(c.Backup,c.Target,true); throw; }
    foreach(var s in staged) if(HashFile(s.Target)!=s.AfterHash) throw new Exception("Post-write hash mismatch: "+s.Target);
}
var report=new { mode=write?"WRITE":"DRY RUN", timestamp=DateTime.Now.ToString("O"), visible_exact_keys=defs.Count, targets=staged.Select(s=>new{target=s.Target,before_sha256=s.BeforeHash,after_sha256=s.AfterHash,priority_counts=s.Counts}), backup_root=write?backupRoot:null, changes=reportChanges.ToDictionary(k=>k.Key,v=>v.Value.Distinct().ToList()) };
var reportPath=Path.Combine(outputRoot,"last-write-report.json"); File.WriteAllText(reportPath,JsonSerializer.Serialize(report,new JsonSerializerOptions{WriteIndented=true}));
Console.WriteLine(JsonSerializer.Serialize(report,new JsonSerializerOptions{WriteIndented=true}));
return 0;
record PKey(string Part, string Component);
record PDef(PKey Key, string Category, string Action, string PartName, int Default);
record WriterConfig(string GameBin, string ShipLibraryRoot, string DirectionalDataFile, string OutputDirectory, string BackupDirectory, string[] Targets);
