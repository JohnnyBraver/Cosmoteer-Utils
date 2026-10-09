using System.Collections;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;

if (args.Length != 3) {
    Console.Error.WriteLine("Usage: CrewTestWriter <source-ship> <new-target-ship> <game-bin>");
    return 2;
}
var source = Path.GetFullPath(args[0]);
var target = Path.GetFullPath(args[1]);
var gameBin = Path.GetFullPath(args[2]);
if (!File.Exists(source)) throw new FileNotFoundException("Source crew template not found", source);
if (File.Exists(target)) throw new IOException("Crew-Test already exists; refusing to overwrite it.");

var game = Assembly.LoadFrom(Path.Combine(gameBin, "Cosmoteer.dll"));
var core = Assembly.LoadFrom(Path.Combine(gameBin, "HalflingCore.dll"));
var shipType = game.GetType("Cosmoteer.Ships.Ship", true)!;
var nodeType = core.GetType("Halfling.ObjectBits.OBNode", true)!;
var textureType = core.GetType("Halfling.Graphics.TextureData", true)!;
var streamType = core.GetType("Halfling.IO.TextureDataStream", true)!;
var formatType = core.GetType("Halfling.Graphics.ImageFileFormat", true)!;
var loadStream = shipType.GetMethod("LoadStream", new[] { typeof(string) })!;
var nodeCtor = nodeType.GetConstructor(new[] { typeof(Stream), typeof(bool) })!;
var entriesMethod = nodeType.GetMethod("EnumerateChildrenByName")!;
var childGetter = nodeType.GetProperty("Item", new[] { typeof(string) })!;
var finalGetter = nodeType.GetProperty("FinalLinkTarget")!;
var dataProperty = nodeType.GetProperty("Data")!;
var writeNode = nodeType.GetMethod("WriteTo", new[] { typeof(Stream) })!;
var loadTexture = textureType.GetMethod("LoadFrom", new[] { typeof(string) })!;
var saveTexture = textureType.GetMethod("SaveTo", new[] { typeof(string), formatType, typeof(int) })!;
var png = Enum.GetValues(formatType).Cast<object>().Single(v => v.ToString()!.Contains("PNG", StringComparison.OrdinalIgnoreCase));

object Final(object node) => finalGetter.GetValue(node)!;
byte[] Data(object node) => (byte[])dataProperty.GetValue(Final(node))!;
object Child(object node, string key) => Final(childGetter.GetValue(Final(node), new object[] { key }) ?? throw new InvalidDataException("Missing node " + key));
string ReadString(object node) { using var reader = new BinaryReader(new MemoryStream(Data(node)), Encoding.UTF8); return reader.ReadString(); }
void SetString(object node, string value) { using var memory = new MemoryStream(); using (var writer = new BinaryWriter(memory, Encoding.UTF8, true)) writer.Write(value); dataProperty.SetValue(Final(node), memory.ToArray()); }
int ReadInt(object node) => BitConverter.ToInt32(Data(node));
void SetInt(object node, int value) => dataProperty.SetValue(Final(node), BitConverter.GetBytes(value));
IEnumerable<object> Children(object node) => ((IEnumerable)Final(node)).Cast<object>().Select(Final);
object ReadRoot(string path) {
    using var encoded = (Stream)loadStream.Invoke(null, new object[] { path })!;
    encoded.Position = 9;
    using var gzip = new GZipStream(encoded, CompressionMode.Decompress);
    return nodeCtor.Invoke(new object[] { gzip, false });
}
string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();
string KeyPart(object entry) => ReadString(Child(Child(entry, "Key"), "PartID"));
string KeyComponent(object entry) => ReadString(Child(Child(entry, "Key"), "ComponentID"));

var root = ReadRoot(source);
if (ReadString(Child(root, "Name")) != "Crew - allrounder") throw new InvalidDataException("Unexpected source design name.");
var roles = Children(Child(root, "Roles")).ToArray();
var defaultRole = roles.Single(role => ReadString(Child(role, "Name")) == "Unasigned");
var priorities = Children(Child(defaultRole, "Priorities")).ToArray();
var targetEntry = priorities.Single(entry => KeyPart(entry) == "cosmoteer.control_room_small" && KeyComponent(entry) == "PartCrew");
var oldValue = ReadInt(Child(targetEntry, "Value"));
SetInt(Child(targetEntry, "Value"), 0);
SetString(Child(root, "Name"), "Crew-Test");

var header = new byte[9];
using (var originalStream = (Stream)loadStream.Invoke(null, new object[] { source })!) {
    if (originalStream.Read(header, 0, header.Length) != header.Length) throw new InvalidDataException("Could not read Cosmoteer save header.");
}
using var encodedShip = new MemoryStream();
encodedShip.Write(header);
using (var gzip = new GZipStream(encodedShip, CompressionLevel.Optimal, true)) writeNode.Invoke(root, new object[] { gzip });
var payload = encodedShip.ToArray();
var texture = loadTexture.Invoke(null, new object[] { source })!;
var temp = target + ".writing.png";
try {
    using (var pixelStream = (Stream)Activator.CreateInstance(streamType, new object[] { texture, true, 1, 1, 1, 0 })!) pixelStream.Write(payload, 0, payload.Length);
    saveTexture.Invoke(texture, new object[] { temp, png, 0 });
} finally {
    if (texture is IDisposable disposable) disposable.Dispose();
}

// Reopen the generated image and check the visible UI setting serialized in the default role.
var checkRoot = ReadRoot(temp);
if (ReadString(Child(checkRoot, "Name")) != "Crew-Test") throw new InvalidDataException("Design name did not survive save.");
var checkRoles = Children(Child(checkRoot, "Roles")).ToArray();
if (!roles.Select(r => ReadString(Child(r, "Name"))).SequenceEqual(checkRoles.Select(r => ReadString(Child(r, "Name"))))) throw new InvalidDataException("Role list changed.");
var checkDefault = checkRoles.Single(role => ReadString(Child(role, "Name")) == "Unasigned");
var checkEntry = Children(Child(checkDefault, "Priorities")).Single(entry => KeyPart(entry) == "cosmoteer.control_room_small" && KeyComponent(entry) == "PartCrew");
if (ReadInt(Child(checkEntry, "Value")) != 0) throw new InvalidDataException("Cockpit Operate priority did not persist as 0.");

File.Move(temp, target);
Console.WriteLine($"Created: {target}");
Console.WriteLine($"Role: Unasigned | UI setting: Cockpit / Operate | key: cosmoteer.control_room_small + PartCrew | {oldValue} -> 0");
Console.WriteLine($"Role count: {checkRoles.Length}; all roles retained; decoded-value check passed.");
Console.WriteLine($"SHA-256: {Hash(target)}");
return 0;
