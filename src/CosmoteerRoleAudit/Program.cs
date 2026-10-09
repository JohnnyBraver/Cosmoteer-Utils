using System.Collections;
using System.Globalization;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

if (args.Length is < 2 or > 3) { Console.Error.WriteLine("Usage: CosmoteerRolesAudit <ship-library-folder> <output-folder> [game-bin]"); return 2; }
var library = Path.GetFullPath(args[0]);
var output = Path.GetFullPath(args[1]);
Directory.CreateDirectory(output);
var gameBin = args.Length == 3 ? Path.GetFullPath(args[2]) : Environment.GetEnvironmentVariable("COSMOTEER_GAME_BIN");
if (string.IsNullOrWhiteSpace(gameBin) || !Directory.Exists(gameBin))
{
    Console.Error.WriteLine("Provide the Cosmoteer Bin folder as the third argument or set COSMOTEER_GAME_BIN.");
    return 2;
}
var game = Assembly.LoadFrom(Path.Combine(gameBin, "Cosmoteer.dll"));
var shipType = game.GetType("Cosmoteer.Ships.Ship", true)!;
var loadStream = shipType.GetMethod("LoadStream", new[] { typeof(string) })!;
var core = Assembly.LoadFrom(Path.Combine(gameBin, "HalflingCore.dll"));
var nodeType = core.GetType("Halfling.ObjectBits.OBNode", true)!;
var getEntries = nodeType.GetMethod("EnumerateChildrenByName")!;
var getSubtree = nodeType.GetMethod("GetSubtreeString")!;
object? Find(object node, string name) { foreach (var entry in (IEnumerable)getEntries.Invoke(node, null)!) { var t = entry!.GetType(); var key = (string)t.GetProperty("Key")!.GetValue(entry)!; var value = t.GetProperty("Value")!.GetValue(entry)!; if (key == name) return value; var found = Find(value, name); if (found != null) return found; } return null; }
string GetRoles(string path) { using var encoded = (Stream)loadStream.Invoke(null, new object[] { path })!; encoded.Position = 9; using var gzip = new GZipStream(encoded, CompressionMode.Decompress); using var decoded = new MemoryStream(); gzip.CopyTo(decoded); decoded.Position = 0; var root = Activator.CreateInstance(nodeType, new object[] { decoded, false })!; var roles = Find(root, "Roles") ?? throw new InvalidDataException("No Roles section found."); return (string)getSubtree.Invoke(roles, null)!; }
string Normalize(string roles) => string.Join("\n", roles.Replace("\r\n", "\n").Split('\n').Select(line => Regex.Replace(line, @"^\d+\t", "")).Where(line => !line.Contains("\"ID\":")));
string Hash(string text) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant()[..16];
string Csv(string value) => "\"" + value.Replace("\"", "\"\"") + "\"";
var rows = new List<(string Path, DateTime Modified, string Hash, int RoleCount, int PriorityCount, string Names, string Error)>();
foreach (var file in Directory.EnumerateFiles(library, "*.ship.png", SearchOption.AllDirectories)) { try { var roles = GetRoles(file); var names = Regex.Matches(roles, @"(?m)^\d+\t\s*""Name"":.*String:""([^""]*)""").Select(m => m.Groups[1].Value).Where(x => !string.IsNullOrEmpty(x)).ToArray(); var profile = Normalize(roles); var hash = Hash(profile); File.WriteAllText(Path.Combine(output, hash + ".roles.txt"), profile); rows.Add((Path.GetRelativePath(library, file), File.GetLastWriteTimeUtc(file), hash, names.Length, roles.Split('\n').Count(line => line.Contains("\"Value\": (Data)")), string.Join(" | ", names), "")); } catch (Exception ex) { rows.Add((Path.GetRelativePath(library, file), File.GetLastWriteTimeUtc(file), "", 0, 0, "", ex.GetBaseException().Message)); } }
using (var writer = new StreamWriter(Path.Combine(output, "ships.csv"), false, new UTF8Encoding(true))) { writer.WriteLine("relative_path,modified_utc,role_profile,role_count,priority_entries,role_names,error"); foreach (var row in rows.OrderBy(r => r.Path, StringComparer.OrdinalIgnoreCase)) writer.WriteLine(string.Join(",", Csv(row.Path), row.Modified.ToString("O", CultureInfo.InvariantCulture), row.Hash, row.RoleCount, row.PriorityCount, Csv(row.Names), Csv(row.Error))); }
using (var writer = new StreamWriter(Path.Combine(output, "profiles.csv"), false, new UTF8Encoding(true))) { writer.WriteLine("role_profile,ship_count,oldest_modified_utc,newest_modified_utc,role_names,examples"); foreach (var group in rows.Where(r => r.Error == "").GroupBy(r => r.Hash).OrderByDescending(g => g.Count())) { var first = group.First(); writer.WriteLine(string.Join(",", group.Key, group.Count(), group.Min(x => x.Modified).ToString("O"), group.Max(x => x.Modified).ToString("O"), Csv(first.Names), Csv(string.Join(" | ", group.Take(5).Select(x => x.Path))))); } }
File.Copy(Path.Combine(Path.GetDirectoryName(library)!, "settings.rules"), Path.Combine(output, "current-default-settings.rules"), true);
File.WriteAllText(Path.Combine(output, "README.txt"), "Read-only role audit. ships.csv lists every ship's role-profile class. profiles.csv groups identical role settings. Each <hash>.roles.txt contains only the extracted Roles block (no ship layout or crew-bunk assignments). current-default-settings.rules contains the current global DefaultRoles source.\r\n");
Console.WriteLine($"Audited {rows.Count} ships; decoded {rows.Count(r => r.Error == "")}; found {rows.Where(r => r.Error == "").Select(r => r.Hash).Distinct().Count()} role profiles.");
return 0;
