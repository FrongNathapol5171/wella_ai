import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
for(const dir of ['src','api','scripts','test']) {
  for(const name of readdirSync(dir).filter(n=>n.endsWith('.js'))) execFileSync(process.execPath,['--check',`${dir}/${name}`],{stdio:'inherit'});
}
console.log('All JavaScript files passed syntax checks');
